// Shared types for the 2ndBrain link. Everything here is plain data so a plan
// can be hashed, printed, and handed to an MCP client as JSON.
import type { Task, TaskImportance } from '@poolendar/types'

/** The stated conflict rule. Shown in the CLI help, the README, and every report. */
export const CONFLICT_RULE =
  'If both sides changed the same field since the last sync, the vault wins, and the app value that lost is listed under conflicts. A field changed on only one side flows to the other.'

export type VaultStatus = 'backlog' | 'in_progress' | 'done'
export type Importance = TaskImportance

/** The fields that sync, in the vault's terms. ✅, 📅 and friends are dates, not timestamps. */
export interface SyncFields {
  title: string
  status: VaultStatus
  due: string | null
  importance: Importance
  completed: string | null
}

export type SyncFieldName = keyof SyncFields

export type AppTask = Pick<
  Task,
  'id' | 'title' | 'status' | 'importance' | 'due_date' | 'completed_at' | 'vault_ref' | 'created_at'
>

export interface TaskCreateInput {
  title: string
  status: VaultStatus
  importance: Importance
  due_date: string | null
  completed_at?: string
  vault_ref: string
}

export interface TaskPatch {
  title?: string
  status?: VaultStatus
  importance?: Importance
  due_date?: string | null
  completed_at?: string
  vault_ref?: string | null
}

/** All the sync needs from the app. Tests use an in-memory fake. */
export interface TasksApi {
  /** Every task on the account, following pagination to the end. */
  listTasks(): Promise<AppTask[]>
  createTask(input: TaskCreateInput): Promise<AppTask>
  updateTask(id: string, patch: TaskPatch): Promise<AppTask>
}

export interface Connection {
  name: string
  /** Absolute real path of the vault root. */
  vault: string
  /** Vault-relative folder with forward slashes. Empty string means the vault root. */
  folder: string
  importAppTasks: boolean
}

export interface StateEntry {
  taskId: string
  file: string
  fields: SyncFields
  /** The raw completed_at last seen, so a timezone change never reads as an edit. */
  appCompletedAt: string | null
}

export interface SyncState {
  version: 1
  connection: string
  entries: Record<string, StateEntry>
  /** Tasks deliberately unlinked from the vault, by task id, so they are not imported back. */
  detached: Record<string, string>
}

export interface VaultChange {
  action: 'update' | 'assign-id' | 'import' | 'cancel'
  file: string
  /** 1-based line number at plan time. Null for a line that does not exist yet. */
  line: number | null
  id: string
  before: string | null
  after: string
  fields: string[]
}

export interface AppChange {
  action: 'create' | 'update' | 'link' | 'clear-ref'
  id: string
  taskId: string | null
  title: string
  fields: Record<string, unknown>
}

export interface ConflictEntry {
  id: string
  file: string
  field: SyncFieldName
  /** The value that won and will be written to the app. */
  vaultValue: string | null
  /** The app value that lost. */
  appValue: string | null
  /** The value both sides had at the last sync. Null when they were never synced. */
  baseValue: string | null
}

export interface SkippedEntry {
  file: string
  line: number | null
  id: string | null
  reason: string
}

export interface RemovedFromVault {
  id: string
  taskId: string
  title: string
  reason: 'line-removed' | 'line-cancelled'
}

export interface DeletedInApp {
  id: string
  taskId: string
  file: string
  line: number
}

export interface Plan {
  planId: string
  vault: string
  folder: string
  empty: boolean
  conflictRule: string
  vaultChanges: VaultChange[]
  appChanges: AppChange[]
  conflicts: ConflictEntry[]
  removedFromVault: RemovedFromVault[]
  deletedInApp: DeletedInApp[]
  /** How many records change only in the state file. */
  stateChanges: number
  skipped: SkippedEntry[]
}

export interface ApplyResult {
  status: 'applied' | 'partial' | 'nothing-to-do'
  planId: string
  conflictRule: string
  /** Vault-relative. Null when nothing needed writing. */
  backupDir: string | null
  filesWritten: string[]
  filesAborted: { file: string; reason: string }[]
  appChangesApplied: number
  appChangesNotRun: number
  apiError: { action: string; id: string; message: string } | null
  stateError: string | null
  conflicts: ConflictEntry[]
  removedFromVault: RemovedFromVault[]
  deletedInApp: DeletedInApp[]
}

/** A deliberate refusal the user can act on, as opposed to a bug. */
export class VaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

export class PlanMismatchError extends VaultError {
  constructor(expected: string, actual: string) {
    super(
      `Plan ${expected} no longer matches: the vault or the app changed since it was made (it would now be ${actual}). Nothing was written. Run plan again and review it.`,
    )
    this.name = 'PlanMismatchError'
  }
}
