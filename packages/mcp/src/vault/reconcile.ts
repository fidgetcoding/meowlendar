// Decides, line by line and task by task, what has to happen to bring the two sides together.
import { parseTaskLine, setDate, setId, setImportance, setStatusChar, setTitle } from './lines.js'
import { VAULT_REF, dateToCompletedAt, fieldsFromApp, fieldsFromLine, newLineId, patchFromFields, sameInstant, statusChar, vaultRef } from './mapping.js'
import { mergeFields, type MergeResult } from './merge.js'
import { editLine, skipLine, type ClassifiedLines, type Draft, type LineRef } from './plan-types.js'
import type { ScannedFile } from './scan.js'
import { VaultError, type AppTask, type RemovedFromVault, type StateEntry, type SyncFields, type TaskCreateInput } from './types.js'

/** Below this many tracked tasks, every one disappearing can plausibly be real. */
const VANISH_GUARD_MIN = 5

export function classifyLines(draft: Draft, files: ScannedFile[]): ClassifiedLines {
  const name = draft.ctx.connection.name
  const counts = new Map<string, number>()
  for (const file of files) {
    for (const line of file.lines) {
      const id = line.task?.id
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  const out: ClassifiedLines = { live: new Map(), cancelled: new Map(), frozen: new Set(), unnamed: [] }
  for (const file of files) {
    for (const line of file.lines) {
      const task = line.task
      if (!task) continue
      const id = task.id
      if (id && (counts.get(id) ?? 0) > 1) {
        out.frozen.add(id)
        skipLine(draft, file, line, id, `The id ${id} is on more than one line. Give one of them a different id.`)
        continue
      }
      if (id && !VAULT_REF.test(vaultRef(name, id))) {
        out.frozen.add(id)
        skipLine(draft, file, line, id, `The id ${id} has characters or a length the app can't store as a link.`)
        continue
      }
      if (task.status === 'other') {
        if (id) out.frozen.add(id)
        skipLine(draft, file, line, id, `The status [${task.statusChar}] has no match in the app.`)
        continue
      }
      if (task.status === 'cancelled') {
        // Cancelled lines are history. With no id there is nothing to sync, so they stay quiet.
        if (id) out.cancelled.set(id, { file, line })
        continue
      }
      const read = fieldsFromLine(task)
      if (!read.ok) {
        if (id) out.frozen.add(id)
        skipLine(draft, file, line, id, read.reason)
        continue
      }
      const ref: LineRef = { file, line, task, fields: read.fields }
      if (id) out.live.set(id, ref)
      else out.unnamed.push(ref)
    }
  }
  return out
}

function rewriteLine(raw: string, result: MergeResult): string {
  const { toVault, merged } = result
  let after = raw
  if (toVault.title !== undefined) after = setTitle(after, toVault.title)
  if (toVault.status !== undefined) after = setStatusChar(after, statusChar(toVault.status))
  if (toVault.due !== undefined) after = setDate(after, 'due', toVault.due)
  if (toVault.importance !== undefined) after = setImportance(after, toVault.importance)
  if (toVault.completed !== undefined) after = setDate(after, 'done', toVault.completed)
  else if (toVault.status === 'done' && merged.completed === null) after = setDate(after, 'done', null)
  return after
}

function sameFields(a: SyncFields, b: SyncFields): boolean {
  return (
    a.title === b.title &&
    a.status === b.status &&
    a.due === b.due &&
    a.importance === b.importance &&
    a.completed === b.completed
  )
}

function sameEntry(a: StateEntry, b: StateEntry): boolean {
  return (
    a.taskId === b.taskId &&
    a.file === b.file &&
    sameInstant(a.appCompletedAt, b.appCompletedAt) &&
    sameFields(a.fields, b.fields)
  )
}

function syncLine(draft: Draft, id: string, ref: LineRef, task: AppTask, entry: StateEntry | null, link: boolean): void {
  const { connection } = draft.ctx
  const result = mergeFields(ref.fields, fieldsFromApp(task, entry), entry?.fields ?? null)

  const after = rewriteLine(ref.line.raw, result)
  if (after !== ref.line.raw) {
    const reread = parseTaskLine(after)
    const check = reread ? fieldsFromLine(reread) : null
    if (!check?.ok || !sameFields(check.fields, result.merged) || reread?.id !== id) {
      skipLine(draft, ref.file, ref.line, id, 'The new values would not read back the same from this line, so I left it alone.')
      return
    }
    editLine(draft, ref.file, ref.line, after)
    draft.vaultChanges.push({
      action: 'update',
      file: ref.file.rel,
      line: ref.line.index + 1,
      id,
      before: ref.line.raw,
      after,
      fields: Object.keys(result.toVault),
    })
  }

  for (const c of result.conflicts) {
    draft.conflicts.push({ id, file: ref.file.rel, field: c.field, vaultValue: c.vault, appValue: c.app, baseValue: c.base })
  }

  const patch = patchFromFields(result.toApp)
  if (link) {
    patch.vault_ref = vaultRef(connection.name, id)
    draft.linkedTaskIds.add(task.id)
  }
  const hasPatch = Object.keys(patch).length > 0
  if (hasPatch) {
    draft.appChanges.push({ action: link ? 'link' : 'update', id, taskId: task.id, title: result.merged.title, fields: { ...patch } })
  }

  const next: StateEntry = { taskId: task.id, file: ref.file.rel, fields: result.merged, appCompletedAt: task.completed_at }
  if (!hasPatch && after === ref.line.raw) {
    if (entry && sameEntry(entry, next)) return
    draft.stateChanges++
  }
  draft.items.push({
    id,
    file: after !== ref.line.raw ? ref.file.rel : null,
    op: hasPatch ? { kind: 'update', taskId: task.id, patch, action: link ? 'link' : 'update' } : null,
    effect: {
      kind: 'upsert',
      file: ref.file.rel,
      fields: result.merged,
      taskId: hasPatch ? null : task.id,
      appCompletedAt: hasPatch ? null : task.completed_at,
    },
  })
}

function createFromLine(draft: Draft, id: string, ref: LineRef, assignedLine: string | null): void {
  const { fields } = ref
  const input: TaskCreateInput = {
    title: fields.title,
    status: fields.status,
    importance: fields.importance,
    due_date: fields.due,
    vault_ref: vaultRef(draft.ctx.connection.name, id),
    ...(fields.completed ? { completed_at: dateToCompletedAt(fields.completed) } : {}),
  }
  if (assignedLine) {
    editLine(draft, ref.file, ref.line, assignedLine)
    draft.vaultChanges.push({
      action: 'assign-id',
      file: ref.file.rel,
      line: ref.line.index + 1,
      id,
      before: ref.line.raw,
      after: assignedLine,
      fields: ['id'],
    })
  }
  draft.appChanges.push({ action: 'create', id, taskId: null, title: fields.title, fields: { ...input } })
  draft.items.push({
    id,
    file: assignedLine ? ref.file.rel : null,
    op: { kind: 'create', input },
    effect: { kind: 'upsert', file: ref.file.rel, fields, taskId: null, appCompletedAt: null },
  })
}

function detach(draft: Draft, id: string, entry: StateEntry, reason: RemovedFromVault['reason']): void {
  const task = draft.byRef.get(id)
  if (task) {
    draft.removed.push({ id, taskId: task.id, title: task.title, reason })
    draft.appChanges.push({ action: 'clear-ref', id, taskId: task.id, title: task.title, fields: { vault_ref: null } })
    draft.items.push({
      id,
      file: null,
      op: { kind: 'update', taskId: task.id, patch: { vault_ref: null }, action: 'clear-ref' },
      effect: { kind: 'drop', detachTaskId: task.id },
    })
    return
  }
  // The link is already gone on the app side, from a run that died or from the task's deletion.
  const known = draft.byTaskId.get(entry.taskId)
  draft.stateChanges++
  draft.items.push({ id, file: null, op: null, effect: { kind: 'drop', detachTaskId: known ? known.id : null } })
}

function markDeletedInApp(draft: Draft, id: string, ref: LineRef, entry: StateEntry): void {
  const after = setDate(setStatusChar(ref.line.raw, '-'), 'cancelled', draft.today)
  editLine(draft, ref.file, ref.line, after)
  draft.deleted.push({ id, taskId: entry.taskId, file: ref.file.rel, line: ref.line.index + 1 })
  draft.vaultChanges.push({
    action: 'cancel',
    file: ref.file.rel,
    line: ref.line.index + 1,
    id,
    before: ref.line.raw,
    after,
    fields: ['status', 'cancelled'],
  })
  draft.items.push({ id, file: ref.file.rel, op: null, effect: { kind: 'drop', detachTaskId: null } })
}

export function reconcileTracked(draft: Draft, lines: ClassifiedLines): void {
  const entries = Object.entries(draft.state.entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  // Every tracked task gone at once is far more likely a wrong API key than a purge,
  // and it would cancel every line in the vault.
  const vanished = entries.filter(([id, e]) => !draft.byRef.has(id) && !draft.byTaskId.has(e.taskId))
  if (entries.length >= VANISH_GUARD_MIN && vanished.length === entries.length) {
    throw new VaultError(
      `None of the ${entries.length} tasks this vault tracks exist in the app. That usually means the API key belongs to another account, so I stopped. If you did delete them all, remove .meowlendar/sync-state.json from the vault and plan again.`,
    )
  }

  for (const [id, entry] of entries) {
    if (lines.frozen.has(id)) continue
    const ref = lines.live.get(id)
    const cancelled = lines.cancelled.get(id)
    if (cancelled) {
      detach(draft, id, entry, 'line-cancelled')
    } else if (!ref) {
      detach(draft, id, entry, 'line-removed')
    } else {
      const task = draft.byRef.get(id)
      if (task) {
        syncLine(draft, id, ref, task, entry, false)
        continue
      }
      const known = draft.byTaskId.get(entry.taskId)
      if (!known) markDeletedInApp(draft, id, ref, entry)
      else if (known.vault_ref === null) syncLine(draft, id, ref, known, entry, true)
      else skipLine(draft, ref.file, ref.line, id, `Task ${known.id} now links to ${known.vault_ref}, so I left this line alone.`)
    }
  }
}

function nextLineId(draft: Draft, file: ScannedFile, occurrence: number, raw: string): string {
  for (let salt = 0; ; salt++) {
    const id = newLineId(file.rel, occurrence, raw, salt)
    if (!draft.usedIds.has(id)) {
      draft.usedIds.add(id)
      return id
    }
  }
}

export function reconcileUntracked(draft: Draft, lines: ClassifiedLines): void {
  for (const [id, ref] of lines.live) {
    if (draft.state.entries[id]) continue
    const task = draft.byRef.get(id)
    if (task) {
      syncLine(draft, id, ref, task, null, false)
      continue
    }
    const candidate = draft.linkCandidates.get(id)
    if (candidate) syncLine(draft, id, ref, candidate, null, true)
    else createFromLine(draft, id, ref, null)
  }

  const seen = new Map<string, number>()
  for (const ref of lines.unnamed) {
    const key = `${ref.file.rel}\0${ref.line.raw.trim()}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const id = nextLineId(draft, ref.file, occurrence, ref.line.raw)
    createFromLine(draft, id, ref, setId(ref.line.raw, id))
  }
}
