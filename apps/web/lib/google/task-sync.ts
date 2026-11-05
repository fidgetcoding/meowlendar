import { createServerClient } from '@supabase/ssr'
import type { Calendar, Task } from '@poolendar/types'
import { requireEnv } from '../env'
import { createGoogleEvent, deleteGoogleEvent, updateGoogleEvent } from './calendar'
import type { GoogleEvent, GoogleEventInsert } from './types'

// Sends scheduled tasks to the Google calendar the user picked, and keeps them
// updated. Off until they pick one. See migration 020 for how edits get noticed.

/** Marks a Google event as the mirror of a task. Private, so not shared with guests. */
export const TASK_ID_PROPERTY = 'meowlendarTaskId'

const DONE_PREFIX = '✓ '
const MAX_RETRIES = 5
/** How far back a newly picked calendar gets existing tasks. */
const BACKFILL_DAYS = 30
const BATCH = 200

function getServiceClient() {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { cookies: { getAll() { return [] }, setAll() {} } },
  )
}
type Service = ReturnType<typeof getServiceClient>

type TaskRow = Pick<
  Task,
  'id' | 'user_id' | 'title' | 'notes' | 'location' | 'status' | 'visibility' | 'privacy' | 'scheduled_start' | 'scheduled_end' | 'is_split' | 'updated_at'
> & {
  google_event_id: string | null
  google_calendar_id: string | null
  google_etag: string | null
  google_dirty: boolean
  google_retry_count: number
}

type GoogleTarget = Pick<Calendar, 'id' | 'google_account_id' | 'google_calendar_id'>

const TASK_COLUMNS =
  'id, user_id, title, notes, location, status, visibility, privacy, scheduled_start, scheduled_end, is_split, updated_at, google_event_id, google_calendar_id, google_etag, google_dirty, google_retry_count'

/** The event a task should look like on Google. */
function taskToGoogle(task: TaskRow): GoogleEventInsert {
  return {
    summary: `${task.status === 'done' ? DONE_PREFIX : ''}${task.title}`,
    description: task.notes ?? undefined,
    location: task.location ?? undefined,
    start: { dateTime: task.scheduled_start as string },
    end: { dateTime: task.scheduled_end as string },
    transparency: task.visibility === 'free' ? 'transparent' : 'opaque',
    visibility: task.privacy === 'private' ? 'private' : 'default',
    extendedProperties: { private: { [TASK_ID_PROPERTY]: task.id } },
  }
}

/** The calendar the user picked, if it's still theirs and they can write to it. */
async function resolveTarget(supabase: Service, userId: string, calendarId: unknown): Promise<GoogleTarget | null> {
  if (typeof calendarId !== 'string' || !calendarId) return null
  const { data, error } = await supabase
    .from('calendars')
    .select('id, google_account_id, google_calendar_id, source, access_role')
    .eq('id', calendarId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read task sync target: ${error.message}`)
  if (!data || data.source !== 'google') return null
  if (data.access_role !== 'owner' && data.access_role !== 'writer') return null
  return data as GoogleTarget
}

/** Records the result. If the task was edited meanwhile, it stays marked for next time. */
async function saveLink(supabase: Service, task: TaskRow, link: Record<string, unknown>) {
  const clean = { ...link, google_retry_count: 0, google_next_retry_at: null }
  const { data, error } = await supabase
    .from('tasks')
    .update({ ...clean, google_dirty: false })
    .eq('id', task.id)
    .eq('updated_at', task.updated_at)
    .select('id')
  if (error) throw new Error(`Failed to store task sync result: ${error.message}`)
  if (!data?.length) {
    const { error: linkError } = await supabase.from('tasks').update(clean).eq('id', task.id)
    if (linkError) throw new Error(`Failed to store changed task link: ${linkError.message}`)
  }
}

async function clearLink(supabase: Service, task: TaskRow) {
  await saveLink(supabase, task, { google_event_id: null, google_calendar_id: null, google_etag: null })
}

async function removeFromGoogle(supabase: Service, task: TaskRow) {
  if (task.google_event_id && task.google_calendar_id) {
    const { data: old } = await supabase
      .from('calendars')
      .select('google_account_id, google_calendar_id')
      .eq('id', task.google_calendar_id)
      .maybeSingle()
    if (old?.google_account_id && old.google_calendar_id) {
      await deleteGoogleEvent(old.google_account_id, old.google_calendar_id, task.google_event_id)
    }
  }
  await clearLink(supabase, task)
}

/**
 * The Google event id for a task. Fixed per task, so two syncs running at once can't
 * make two events: Google refuses the second create. Hex digits are valid in Google's
 * base32hex ids.
 */
export function googleEventIdForTask(taskId: string): string {
  return `mt${taskId.replace(/-/g, '').toLowerCase()}`
}

/** The task a Google event id was made for, or null for any other id. */
export function taskIdFromGoogleEventId(eventId: string): string | null {
  const m = /^mt([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(eventId)
  return m ? m.slice(1).join('-') : null
}

async function pushTask(supabase: Service, task: TaskRow, target: GoogleTarget) {
  const accountId = target.google_account_id as string
  const googleCalendarId = target.google_calendar_id as string
  const payload = taskToGoogle(task)
  const eventId = googleEventIdForTask(task.id)

  let result: GoogleEvent | null = null
  if (task.google_event_id) {
    try {
      result = await updateGoogleEvent(accountId, googleCalendarId, task.google_event_id, payload)
    } catch (err) {
      // Deleted on Google while a local edit was waiting. The edit wins: recreate it.
      if (!/\b(404|410)\b/.test(String(err))) throw err
    }
  }
  if (!result) {
    try {
      result = await createGoogleEvent(accountId, googleCalendarId, { ...payload, id: eventId })
    } catch (err) {
      // Already exists: another sync got there first, or it was deleted on Google and
      // the id is still taken. Either way there's one event, so bring it up to date.
      if (!/\b409\b/.test(String(err))) throw err
      result = await updateGoogleEvent(accountId, googleCalendarId, eventId, {
        ...payload,
        status: 'confirmed',
      })
    }
  }
  await saveLink(supabase, task, {
    google_event_id: result?.id,
    google_calendar_id: target.id,
    google_etag: result?.etag ?? null,
  })
}

async function markFailure(supabase: Service, task: TaskRow, err: unknown) {
  const count = task.google_retry_count + 1
  console.error(`[task-sync] task ${task.id} failed (attempt ${count}):`, err)
  await supabase
    .from('tasks')
    .update({
      google_retry_count: count,
      google_next_retry_at: new Date(Date.now() + Math.min(2 ** count, 60) * 60_000).toISOString(),
    })
    .eq('id', task.id)
}

async function syncUser(supabase: Service, userId: string, settings: Record<string, unknown> | null) {
  const target = await resolveTarget(supabase, userId, settings?.task_sync_calendar_id)
  const totals = { pushed: 0, removed: 0, failed: 0 }
  const now = new Date().toISOString()

  // Linked somewhere other than the current choice, including nowhere: take it down.
  let stale = supabase.from('tasks').select(TASK_COLUMNS).eq('user_id', userId).not('google_event_id', 'is', null).limit(BATCH)
  if (target) stale = stale.or(`google_calendar_id.is.null,google_calendar_id.neq.${target.id}`)
  const { data: staleTasks } = await stale

  for (const task of (staleTasks ?? []) as unknown as TaskRow[]) {
    try {
      await removeFromGoogle(supabase, task)
      totals.removed++
    } catch (err) {
      totals.failed++
      await markFailure(supabase, task, err)
    }
  }

  if (!target) return totals

  const { data: changed } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('user_id', userId)
    .eq('google_dirty', true)
    .lt('google_retry_count', MAX_RETRIES)
    .or(`google_next_retry_at.is.null,google_next_retry_at.lte.${now}`)
    .limit(BATCH)

  // Tasks scheduled before this calendar was picked.
  const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60_000).toISOString()
  const { data: unlinked } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('user_id', userId)
    .is('google_event_id', null)
    .not('scheduled_start', 'is', null)
    .gte('scheduled_end', since)
    .lt('google_retry_count', MAX_RETRIES)
    .or(`google_next_retry_at.is.null,google_next_retry_at.lte.${now}`)
    .limit(BATCH)

  const seen = new Set<string>()
  for (const task of [...(changed ?? []), ...(unlinked ?? [])] as unknown as TaskRow[]) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    try {
      if (task.scheduled_start && task.scheduled_end && !task.is_split) {
        await pushTask(supabase, task, target)
        totals.pushed++
      } else if (task.google_event_id) {
        await removeFromGoogle(supabase, task)
        totals.removed++
      } else {
        await saveLink(supabase, task, {})
      }
    } catch (err) {
      totals.failed++
      await markFailure(supabase, task, err)
    }
  }
  return totals
}

/** Runs the sync for one user, or for everyone who has anything to do. */
export async function flushTaskSync(options: { userId?: string } = {}) {
  const supabase = getServiceClient()
  const totals = { pushed: 0, removed: 0, failed: 0 }

  let users: { id: string; settings: Record<string, unknown> | null }[] = []
  if (options.userId) {
    const { data } = await supabase.from('profiles').select('id, settings').eq('id', options.userId)
    users = data ?? []
  } else {
    const { data: picked } = await supabase
      .from('profiles')
      .select('id, settings')
      .not('settings->>task_sync_calendar_id', 'is', null)
      .limit(1000)
    // Someone who turned it off still has events to take down.
    const { data: linked } = await supabase
      .from('tasks')
      .select('user_id')
      .not('google_event_id', 'is', null)
      .limit(1000)
    const ids = new Set((picked ?? []).map((p) => p.id as string))
    const extra = [...new Set((linked ?? []).map((t) => t.user_id as string))].filter((id) => !ids.has(id))
    const { data: others } = extra.length
      ? await supabase.from('profiles').select('id, settings').in('id', extra)
      : { data: [] }
    users = [...(picked ?? []), ...(others ?? [])]
  }

  for (const user of users) {
    const result = await syncUser(supabase, user.id, user.settings)
    totals.pushed += result.pushed
    totals.removed += result.removed
    totals.failed += result.failed
  }
  return totals
}

/**
 * Handles an incoming Google event that mirrors a task. Returns false when it isn't
 * one. It never creates an event row, which is what stops a mirrored task showing
 * twice. A task with its own edit waiting keeps that edit, and an event whose etag
 * we wrote ourselves is ignored, so nothing bounces back and forth.
 */
export async function applyIncomingTaskEvent(
  supabase: Service,
  googleEvent: GoogleEvent,
  userId: string,
  calendarId: string,
): Promise<'updated' | 'deleted' | false> {
  // The private property marks a mirror. Google may hold it back from another
  // account sharing the calendar, so the id we gave the event is checked as well.
  const marked = googleEvent.extendedProperties?.private?.[TASK_ID_PROPERTY]
  const taskId = marked ?? taskIdFromGoogleEventId(googleEvent.id)
  if (!taskId) return false

  const { data: task, error: readError } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('id', taskId)
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) throw new Error(`Failed to read mirrored task: ${readError.message}`)
  const row = task as unknown as TaskRow | null
  // Only an id that looks like ours, with no task behind it, is an ordinary event.
  if (!row && !marked) return false
  // No such task for this user. Either way it must not become an event.
  if (!row || row.google_event_id !== googleEvent.id || row.google_calendar_id !== calendarId) return 'updated'

  // A queued local edit wins even when the remote change is a deletion.
  if (row.google_dirty) return 'updated'

  if (googleEvent.status === 'cancelled') {
    // Removed from the calendar on Google: the task goes back to being unscheduled.
    const { error } = await supabase
      .from('tasks')
      .update({
        scheduled_start: null,
        scheduled_end: null,
        google_event_id: null,
        google_calendar_id: null,
        google_etag: null,
        google_dirty: false,
      })
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .eq('google_dirty', false)
    if (error) throw new Error(`Failed to unschedule mirrored task: ${error.message}`)
    return 'deleted'
  }

  if (row.google_etag === googleEvent.etag) return 'updated'

  const title = (googleEvent.summary ?? row.title).replace(new RegExp(`^${DONE_PREFIX}`), '')
  const { error } = await supabase
    .from('tasks')
    .update({
      title,
      notes: googleEvent.description ?? null,
      location: googleEvent.location ?? null,
      scheduled_start: googleEvent.start?.dateTime ?? row.scheduled_start,
      scheduled_end: googleEvent.end?.dateTime ?? row.scheduled_end,
      google_etag: googleEvent.etag ?? null,
    })
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .eq('google_dirty', false)
  if (error) throw new Error(`Failed to update mirrored task: ${error.message}`)
  return 'updated'
}
