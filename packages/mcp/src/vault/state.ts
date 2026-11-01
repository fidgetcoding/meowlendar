// <vault>/.meowlendar/sync-state.json: what each side looked like at the last sync.
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hashBytes } from './scan.js'
import { writeAtomic } from './fs-safe.js'
import { STATE_DIR, STATE_FILE } from './paths.js'
import { VaultError, type StateEntry, type SyncFields, type SyncState } from './types.js'

export interface LoadedState {
  state: SyncState
  /** Hash of the bytes on disk, null when there is no state file yet. */
  hash: string | null
}

function statePath(vault: string): string {
  return join(vault, STATE_DIR, STATE_FILE)
}

function isFields(value: unknown): value is SyncFields {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Record<string, unknown>
  return typeof f.title === 'string' && typeof f.status === 'string' && typeof f.importance === 'string'
}

function isEntry(value: unknown): value is StateEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return typeof e.taskId === 'string' && typeof e.file === 'string' && isFields(e.fields)
}

function parseState(text: string): SyncState {
  const data = JSON.parse(text) as Record<string, unknown>
  const entries = data.entries as Record<string, unknown> | undefined
  if (data.version !== 1 || typeof data.connection !== 'string' || typeof entries !== 'object' || entries === null) {
    throw new Error('Unexpected shape')
  }
  if (!Object.values(entries).every(isEntry)) throw new Error('Unexpected entry')
  return {
    version: 1,
    connection: data.connection,
    entries: entries as Record<string, StateEntry>,
    detached: (data.detached ?? {}) as Record<string, string>,
  }
}

/** A damaged state file stops the sync: treating it as empty would relink everything blindly. */
export async function loadState(vault: string, connection: string): Promise<LoadedState> {
  const path = statePath(vault)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return { state: { version: 1, connection, entries: {}, detached: {} }, hash: null }
  }
  let state: SyncState
  try {
    state = parseState(bytes.toString('utf8'))
  } catch {
    throw new VaultError(
      `${path} can't be read as sync state. Restore it from .meowlendar/backups before syncing again.`,
    )
  }
  if (state.connection !== connection) {
    throw new VaultError(
      `This vault was last synced under the name "${state.connection}". Task links use that name, so connect it as "${state.connection}" instead of "${connection}".`,
    )
  }
  return { state, hash: hashBytes(bytes) }
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export async function saveState(vault: string, state: SyncState): Promise<void> {
  await mkdir(join(vault, STATE_DIR), { recursive: true })
  const body = {
    ...state,
    entries: sortedRecord(state.entries),
    detached: sortedRecord(state.detached),
  }
  await writeAtomic(statePath(vault), `${JSON.stringify(body, null, 2)}\n`, 0o644)
}
