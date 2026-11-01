// Translation between a line and an app task. Comparisons happen in the vault's
// terms, so a value the vault can't express (the app's `check` column, a timestamp)
// never reads as an edit.
import { createHash } from 'node:crypto'
import { normalizeTitle, type ParsedTask } from './lines.js'
import type { AppTask, Importance, StateEntry, SyncFields, TaskPatch, VaultStatus } from './types.js'

// Mirrors VAULT_REF_PATTERN in @poolendar/validators, a test keeps them equal. The
// validators package pulls in zod, which this bundle has no other reason to carry.
export const VAULT_REF = /^[A-Za-z0-9_.:-]{1,128}$/
export const VAULT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
export const MAX_TITLE_LENGTH = 500

export function vaultRef(name: string, id: string): string {
  return `${name}:${id}`
}

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The calendar date on this machine for a moment in time. */
export function localDate(moment: Date): string {
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`
}

/** A ✅ date as a timestamp: local noon, so it reads back as the same date here. */
export function dateToCompletedAt(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toISOString()
}

function statusFromLine(task: ParsedTask): VaultStatus {
  if (task.status === 'done') return 'done'
  if (task.status === 'in_progress') return 'in_progress'
  return 'backlog'
}

export function statusChar(status: VaultStatus): string {
  if (status === 'done') return 'x'
  if (status === 'in_progress') return '/'
  return ' '
}

export type LineFields = { ok: true; fields: SyncFields } | { ok: false; reason: string }

/** Reads a line's fields, or says why it can't sync as written. */
export function fieldsFromLine(task: ParsedTask): LineFields {
  if (task.title === '') return { ok: false, reason: 'The line has no task text.' }
  if (task.title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: `The task text is over ${MAX_TITLE_LENGTH} characters.` }
  }
  if (task.due !== null && !isValidDate(task.due)) {
    return { ok: false, reason: `The due date ${task.due} is not a real date.` }
  }
  const status = statusFromLine(task)
  if (status === 'done' && task.done !== null && !isValidDate(task.done)) {
    return { ok: false, reason: `The done date ${task.done} is not a real date.` }
  }
  return {
    ok: true,
    fields: {
      title: task.title,
      status,
      due: task.due,
      importance: task.importance,
      completed: status === 'done' ? task.done : null,
    },
  }
}

function statusFromApp(status: AppTask['status']): VaultStatus {
  if (status === 'done') return 'done'
  if (status === 'backlog') return 'backlog'
  // The vault has no `check` column. A checked task reads as in progress.
  return 'in_progress'
}

/** The API can format one moment more than one way, so timestamps compare as moments. */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return a === b || Date.parse(a) === Date.parse(b)
}

function appCompleted(task: AppTask, base: StateEntry | null): string | null {
  if (task.status !== 'done') return null
  // Same timestamp as last time means no edit, whatever the date reads as today.
  if (base && base.fields.status === 'done' && sameInstant(base.appCompletedAt, task.completed_at)) {
    return base.fields.completed
  }
  return task.completed_at ? localDate(new Date(task.completed_at)) : null
}

export function fieldsFromApp(task: AppTask, base: StateEntry | null): SyncFields {
  return {
    title: normalizeTitle(task.title) || (base?.fields.title ?? ''),
    status: statusFromApp(task.status),
    due: task.due_date ? task.due_date.slice(0, 10) : null,
    importance: (task.importance ?? 'normal') as Importance,
    completed: appCompleted(task, base),
  }
}

export function patchFromFields(fields: Partial<SyncFields>): TaskPatch {
  const patch: TaskPatch = {}
  if (fields.title !== undefined) patch.title = fields.title
  if (fields.status !== undefined) patch.status = fields.status
  if (fields.importance !== undefined) patch.importance = fields.importance
  if (fields.due !== undefined) patch.due_date = fields.due
  if (fields.completed) patch.completed_at = dateToCompletedAt(fields.completed)
  return patch
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}

/**
 * Ids come from the content, not a random source: re-planning has to give the same
 * plan, and a sync that died halfway has to recognize its own work when it re-runs.
 */
export function newLineId(file: string, occurrence: number, raw: string, salt: number): string {
  return `mw-${shortHash(`line\0${file}\0${occurrence}\0${raw.trim()}\0${salt}`)}`
}

export function importId(taskId: string): string {
  return `mw-${shortHash(`task\0${taskId}`)}`
}
