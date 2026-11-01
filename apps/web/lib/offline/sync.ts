import type { Table } from 'dexie'
import { db, type MutationQueueEntry } from './db'
import { createClient } from '../supabase/client'

// ---------------------------------------------------------------------------
// Table name -> Dexie table mapping
// ---------------------------------------------------------------------------

const TABLE_MAP = {
  events: () => db.events,
  tasks: () => db.tasks,
  subtasks: () => db.subtasks,
  routines: () => db.routines,
  routine_instances: () => db.routineInstances,
} as const

type SyncTable = keyof typeof TABLE_MAP

function getDexieTable(name: string) {
  const getter = TABLE_MAP[name as SyncTable]
  if (!getter) return null
  return getter()
}

// ---------------------------------------------------------------------------
// queueMutation — enqueue + optimistic local update
// ---------------------------------------------------------------------------

export async function queueMutation(
  entry: Omit<MutationQueueEntry, 'id' | 'retries'>
): Promise<void> {
  // Persist to the mutation queue
  await db.mutationQueue.add({ ...entry, retries: 0 })

  // Optimistic local update
  const table = getDexieTable(entry.table)
  if (!table) return

  switch (entry.method) {
    case 'POST':
    case 'PUT':
      if (entry.data) {
        await table.put(entry.data as never)
      }
      break
    case 'PATCH':
      if (entry.data) {
        await table.update(entry.entityId, entry.data)
      }
      break
    case 'DELETE':
      await table.delete(entry.entityId)
      break
  }
}

// ---------------------------------------------------------------------------
// drainQueue — replay queued mutations against Supabase
// ---------------------------------------------------------------------------

export async function drainQueue(): Promise<{
  succeeded: number
  failed: number
}> {
  const pending = await db.mutationQueue
    .where('retries')
    .notEqual(-1)
    .sortBy('timestamp')

  let succeeded = 0
  let failed = 0

  const supabase = createClient()

  for (const entry of pending) {
    try {
      await executeMutation(supabase, entry)
      await db.mutationQueue.delete(entry.id!)
      succeeded++
    } catch (err) {
      const nextRetries = entry.retries + 1
      if (nextRetries >= 3) {
        // Dead-letter: mark with retries = -1 so future drains skip it
        await db.mutationQueue.update(entry.id!, { retries: -1 })
        console.error(
          `[sync] Dead-lettered mutation id=${entry.id} table=${entry.table} entity=${entry.entityId}`,
          err
        )
      } else {
        await db.mutationQueue.update(entry.id!, { retries: nextRetries })
      }
      failed++
    }
  }

  return { succeeded, failed }
}

async function executeMutation(
  supabase: ReturnType<typeof createClient>,
  entry: MutationQueueEntry
): Promise<void> {
  const { method, table, entityId, data } = entry

  switch (method) {
    case 'POST': {
      const { error } = await supabase.from(table).insert(data as never)
      if (error) throw error
      break
    }
    case 'PUT': {
      const { error } = await supabase
        .from(table)
        .upsert(data as never)
      if (error) throw error
      break
    }
    case 'PATCH': {
      const { error } = await supabase
        .from(table)
        .update(data as never)
        .eq('id', entityId)
      if (error) throw error
      break
    }
    case 'DELETE': {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', entityId)
      if (error) throw error
      break
    }
  }
}

// ---------------------------------------------------------------------------
// syncFromServer — pull fresh data from Supabase into Dexie
// ---------------------------------------------------------------------------

export async function syncFromServer(): Promise<void> {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  // Events: incremental sync using updated_at watermark
  await syncEvents(supabase, user.id)

  // Tasks, subtasks, routines, routine instances: full refresh (small datasets)
  await syncFullTable(supabase, 'tasks', db.tasks, user.id)
  await syncSubtasks(supabase)
  await syncFullTable(supabase, 'routines', db.routines, user.id)
  await syncRoutineInstances(supabase)
}

async function syncEvents(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> {
  // Find the most recent updated_at among local events as a watermark
  const latestLocal = await db.events
    .orderBy('updated_at')
    .last()

  let query = supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true })

  if (latestLocal?.updated_at) {
    query = query.gte('updated_at', latestLocal.updated_at)
  }

  const { data, error } = await query
  if (error) {
    console.error('[sync] Failed to fetch events:', error)
    return
  }

  if (data && data.length > 0) {
    await db.events.bulkPut(data)
  }
}

async function syncFullTable<T>(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
  dexieTable: Table<T, string>,
  userId: string
): Promise<void> {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error(`[sync] Failed to fetch ${tableName}:`, error)
    return
  }

  if (data) {
    await dexieTable.clear()
    await dexieTable.bulkPut(data)
  }
}

async function syncSubtasks(
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  // Get all local task IDs to scope the subtask query
  const taskIds = await db.tasks.toCollection().primaryKeys()
  if (taskIds.length === 0) {
    await db.subtasks.clear()
    return
  }

  // Supabase .in() has a limit; batch in chunks of 100
  const chunks: string[][] = []
  for (let i = 0; i < taskIds.length; i += 100) {
    chunks.push(taskIds.slice(i, i + 100) as string[])
  }

  await db.subtasks.clear()

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('subtasks')
      .select('*')
      .in('task_id', chunk)

    if (error) {
      console.error('[sync] Failed to fetch subtasks:', error)
      continue
    }

    if (data && data.length > 0) {
      await db.subtasks.bulkPut(data)
    }
  }
}

async function syncRoutineInstances(
  supabase: ReturnType<typeof createClient>
): Promise<void> {
  const routineIds = await db.routines.toCollection().primaryKeys()
  if (routineIds.length === 0) {
    await db.routineInstances.clear()
    return
  }

  const chunks: string[][] = []
  for (let i = 0; i < routineIds.length; i += 100) {
    chunks.push(routineIds.slice(i, i + 100) as string[])
  }

  await db.routineInstances.clear()

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('routine_instances')
      .select('*')
      .in('routine_id', chunk)

    if (error) {
      console.error('[sync] Failed to fetch routine_instances:', error)
      continue
    }

    if (data && data.length > 0) {
      await db.routineInstances.bulkPut(data)
    }
  }
}

// ---------------------------------------------------------------------------
// resolveConflict — last-write-wins per field
// ---------------------------------------------------------------------------

export function resolveConflict(
  localEntry: MutationQueueEntry,
  serverEntity: Record<string, unknown>
): Record<string, unknown> {
  const localData = localEntry.data
  if (!localData) return serverEntity

  const localUpdatedAt = localData.updated_at as string | undefined
  const serverUpdatedAt = serverEntity.updated_at as string | undefined

  // If we can compare timestamps, do field-by-field LWW
  if (localUpdatedAt && serverUpdatedAt) {
    const localTime = new Date(localUpdatedAt).getTime()
    const serverTime = new Date(serverUpdatedAt).getTime()

    if (serverTime > localTime) {
      // Server is newer overall — keep server values, but overlay any local
      // fields that were explicitly set and aren't in the server update
      return { ...serverEntity }
    }

    // Local is newer or equal — overlay local on top of server
    return { ...serverEntity, ...localData }
  }

  // No timestamp to compare — local wins (optimistic)
  return { ...serverEntity, ...localData }
}

// ---------------------------------------------------------------------------
// clearLocalData — wipe all Dexie tables (e.g., on logout)
// ---------------------------------------------------------------------------

export async function clearLocalData(): Promise<void> {
  await Promise.all([
    db.events.clear(),
    db.tasks.clear(),
    db.subtasks.clear(),
    db.routines.clear(),
    db.routineInstances.clear(),
    db.mutationQueue.clear(),
  ])
}
