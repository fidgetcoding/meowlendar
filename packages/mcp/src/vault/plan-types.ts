// The shapes a plan is built from, shared by the planner and by apply.
import type { FileLine, ParsedTask } from './lines.js'
import type { ScannedFile } from './scan.js'
import type {
  AppChange,
  AppTask,
  Connection,
  ConflictEntry,
  DeletedInApp,
  Plan,
  RemovedFromVault,
  SkippedEntry,
  SyncFields,
  SyncState,
  TaskCreateInput,
  TaskPatch,
  TasksApi,
  VaultChange,
} from './types.js'

export const IMPORT_FILE_NAME = 'Meowlendar.md'

export interface PlanContext {
  connection: Connection
  api: TasksApi
  now: () => Date
}

export type ApiOp =
  | { kind: 'create'; input: TaskCreateInput }
  | { kind: 'update'; taskId: string; patch: TaskPatch; action: 'update' | 'link' | 'clear-ref' }

export type StateEffect =
  /** Record the line as synced. Task id and completed_at come from the API response when there is an op. */
  | { kind: 'upsert'; file: string; fields: SyncFields; taskId: string | null; appCompletedAt: string | null }
  | { kind: 'drop'; detachTaskId: string | null }

export interface SyncItem {
  id: string
  /** The vault file that has to be written before this can happen. */
  file: string | null
  op: ApiOp | null
  effect: StateEffect
}

export interface FileWrite {
  rel: string
  expectedHash: string | null
  content: string
}

export interface ComputedPlan {
  plan: Plan
  writes: FileWrite[]
  items: SyncItem[]
  state: SyncState
  vault: string
}

export interface LineRef {
  file: ScannedFile
  line: FileLine
  task: ParsedTask
  fields: SyncFields
}

export interface Draft {
  ctx: PlanContext
  state: SyncState
  today: string
  byRef: Map<string, AppTask>
  byTaskId: Map<string, AppTask>
  usedIds: Set<string>
  linkedTaskIds: Set<string>
  /** Unlinked tasks a line can claim by id: unfinished imports and tasks whose line came back. */
  linkCandidates: Map<string, AppTask>
  edits: Map<string, Map<number, string>>
  items: SyncItem[]
  vaultChanges: VaultChange[]
  appChanges: AppChange[]
  conflicts: ConflictEntry[]
  removed: RemovedFromVault[]
  deleted: DeletedInApp[]
  skipped: SkippedEntry[]
  stateChanges: number
}

export function skipLine(draft: Draft, file: ScannedFile, line: FileLine, id: string | null, reason: string): void {
  draft.skipped.push({ file: file.rel, line: line.index + 1, id, reason })
}

export function editLine(draft: Draft, file: ScannedFile, line: FileLine, after: string): void {
  let perFile = draft.edits.get(file.rel)
  if (!perFile) {
    perFile = new Map()
    draft.edits.set(file.rel, perFile)
  }
  perFile.set(line.index, after)
}

export interface ClassifiedLines {
  live: Map<string, LineRef>
  cancelled: Map<string, { file: ScannedFile; line: FileLine }>
  /** Ids on lines that can't sync right now. They stay linked but nothing happens to them. */
  frozen: Set<string>
  unnamed: LineRef[]
}
