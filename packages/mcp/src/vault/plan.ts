// Works out what a sync would do. Read only: nothing here touches the vault or the
// app beyond reading them, and the same inputs always give the same plan and plan ID.
import { planImports } from './imports.js'
import { renderMarkdown } from './lines.js'
import { importId, localDate } from './mapping.js'
import { assertStateDirSafe, resolveVaultPaths } from './paths.js'
import type { ComputedPlan, Draft, FileWrite, PlanContext } from './plan-types.js'
import { classifyLines, reconcileTracked, reconcileUntracked } from './reconcile.js'
import { hashBytes, scanFolder, type ScannedFile } from './scan.js'
import { loadState } from './state.js'
import { CONFLICT_RULE, type AppTask, type SyncState } from './types.js'

export type { ApiOp, ComputedPlan, FileWrite, PlanContext, StateEffect, SyncItem } from './plan-types.js'
export { IMPORT_FILE_NAME } from './plan-types.js'

function buildWrites(draft: Draft, files: ScannedFile[]): Map<string, FileWrite> {
  const writes = new Map<string, FileWrite>()
  for (const file of files) {
    const perFile = draft.edits.get(file.rel)
    if (!perFile) continue
    const content = renderMarkdown(file.lines.map((l) => ({ raw: perFile.get(l.index) ?? l.raw, eol: l.eol })))
    writes.set(file.rel, { rel: file.rel, expectedHash: file.hash, content })
  }
  return writes
}

function collectUsedIds(state: SyncState, files: ScannedFile[], tasks: AppTask[], name: string): Set<string> {
  const used = new Set(Object.keys(state.entries))
  for (const file of files) {
    for (const line of file.lines) if (line.task?.id) used.add(line.task.id)
  }
  const prefix = `${name}:`
  for (const task of tasks) {
    if (task.vault_ref?.startsWith(prefix)) used.add(task.vault_ref.slice(prefix.length))
  }
  return used
}

function collectLinkCandidates(state: SyncState, tasks: AppTask[]): Map<string, AppTask> {
  const candidates = new Map<string, AppTask>()
  for (const task of tasks) {
    if (task.vault_ref !== null) continue
    candidates.set(importId(task.id), task)
    const detachedId = state.detached[task.id]
    if (detachedId !== undefined) candidates.set(detachedId, task)
  }
  return candidates
}

export async function computePlan(ctx: PlanContext): Promise<ComputedPlan> {
  const { connection, api, now } = ctx
  const { vault, folder, folderAbs } = await resolveVaultPaths(connection.vault, connection.folder === '' ? '.' : connection.folder)
  await assertStateDirSafe(vault)
  const { state, hash: stateHash } = await loadState(vault, connection.name)
  const scan = await scanFolder(vault, folderAbs)
  const tasks = await api.listTasks()

  const prefix = `${connection.name}:`
  const byRef = new Map<string, AppTask>()
  for (const task of tasks) {
    if (task.vault_ref?.startsWith(prefix)) byRef.set(task.vault_ref.slice(prefix.length), task)
  }

  const draft: Draft = {
    ctx: { ...ctx, connection: { ...connection, folder } },
    state,
    today: localDate(now()),
    byRef,
    byTaskId: new Map(tasks.map((t) => [t.id, t])),
    usedIds: collectUsedIds(state, scan.files, tasks, connection.name),
    linkedTaskIds: new Set(),
    linkCandidates: collectLinkCandidates(state, tasks),
    edits: new Map(),
    items: [],
    vaultChanges: [],
    appChanges: [],
    conflicts: [],
    removed: [],
    deleted: [],
    skipped: [...scan.skipped],
    stateChanges: 0,
  }

  const lines = classifyLines(draft, scan.files)
  reconcileTracked(draft, lines)
  reconcileUntracked(draft, lines)
  const writes = buildWrites(draft, scan.files)
  if (connection.importAppTasks) await planImports(draft, lines, tasks, scan.files, vault, writes)

  const body = {
    vault: connection.name,
    folder,
    empty: draft.vaultChanges.length === 0 && draft.appChanges.length === 0 && draft.stateChanges === 0,
    conflictRule: CONFLICT_RULE,
    vaultChanges: draft.vaultChanges,
    appChanges: draft.appChanges,
    conflicts: draft.conflicts,
    removedFromVault: draft.removed,
    deletedInApp: draft.deleted,
    stateChanges: draft.stateChanges,
    skipped: draft.skipped,
  }
  const planId = hashBytes(
    JSON.stringify({
      body,
      files: scan.files.map((f) => [f.rel, f.hash]),
      state: stateHash,
    }),
  ).slice(0, 32)

  return {
    plan: { planId, ...body },
    writes: [...writes.values()],
    items: draft.items,
    state,
    vault,
  }
}
