// Three-way merge per field against the last-synced snapshot. See CONFLICT_RULE.
import type { SyncFieldName, SyncFields } from './types.js'

export interface FieldConflict {
  field: SyncFieldName
  vault: string | null
  app: string | null
  base: string | null
}

export interface MergeResult {
  merged: SyncFields
  /** Fields the app has to take from the vault. */
  toApp: Partial<SyncFields>
  /** Fields the line has to take from the app. */
  toVault: Partial<SyncFields>
  conflicts: FieldConflict[]
}

type SimpleField = 'title' | 'status' | 'due' | 'importance'
const SIMPLE_FIELDS: SimpleField[] = ['title', 'status', 'due', 'importance']

function assign<K extends SyncFieldName>(target: Partial<SyncFields>, field: K, value: SyncFields[K]): void {
  target[field] = value
}

export function mergeFields(vault: SyncFields, app: SyncFields, base: SyncFields | null): MergeResult {
  const merged: SyncFields = { ...vault }
  const toApp: Partial<SyncFields> = {}
  const toVault: Partial<SyncFields> = {}
  const conflicts: FieldConflict[] = []

  const takeVault = <K extends SyncFieldName>(field: K) => assign(toApp, field, vault[field])
  const takeApp = <K extends SyncFieldName>(field: K) => {
    assign(toVault, field, app[field])
    assign(merged, field, app[field])
  }
  const conflict = (field: SyncFieldName) => {
    conflicts.push({ field, vault: vault[field], app: app[field], base: base ? base[field] : null })
    takeVault(field)
  }

  for (const field of SIMPLE_FIELDS) {
    if (vault[field] === app[field]) continue
    if (!base) conflict(field)
    else if (app[field] === base[field]) takeVault(field)
    else if (vault[field] === base[field]) takeApp(field)
    else conflict(field)
  }

  mergeCompleted({ vault, app, base, merged, toApp, toVault, takeApp, conflict })
  return { merged, toApp, toVault, conflicts }
}

interface CompletedContext {
  vault: SyncFields
  app: SyncFields
  base: SyncFields | null
  merged: SyncFields
  toApp: Partial<SyncFields>
  toVault: Partial<SyncFields>
  takeApp: (field: 'completed') => void
  conflict: (field: 'completed') => void
}

/**
 * The completion date only means something on a task that ends up done, and a line
 * without ✅ has no opinion about it: `[x] Pay rent` is complete, date unstated. So
 * a missing ✅ never blanks the app's date, and a line that lost its ✅ stays that way.
 */
function mergeCompleted(ctx: CompletedContext): void {
  const { vault, app, base, merged, toApp, toVault, takeApp, conflict } = ctx
  if (merged.status !== 'done') {
    merged.completed = null
    if (vault.completed !== null) toVault.completed = null
    return
  }
  if (vault.completed === app.completed) return
  if (vault.completed === null) {
    if (!base) return
    const lineDroppedDate = base.completed !== null && app.completed === base.completed
    if (!lineDroppedDate) takeApp('completed')
    return
  }
  if (app.completed === null || (base && app.completed === base.completed)) {
    toApp.completed = vault.completed
    return
  }
  if (base && vault.completed === base.completed) takeApp('completed')
  else conflict('completed')
}
