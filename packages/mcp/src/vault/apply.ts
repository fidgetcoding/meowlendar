// Carries out a plan. Order matters and is what makes a re-run converge:
//
//   1. Recompute the plan. A different ID stops here with nothing written.
//   2. Back up. A failed backup stops here with nothing written.
//   3. Write the vault files, so a new line has its id on disk before any task
//      claims it. A file edited since the plan is left alone, and so is everything
//      that depended on it.
//   4. Call the app. The first failure stops further calls.
//   5. Save the state, recording only what actually happened.
//
// If it dies anywhere in between, the next plan sees the leftovers and merges them:
// a line and task that agree are simply in sync, a task carrying a line's ref gets
// adopted instead of created, and an unfinished import is recognized by its id.
import { join } from 'node:path'
import { backupFiles, writeIfUnchanged } from './fs-safe.js'
import { assertStateDirSafe } from './paths.js'
import { computePlan, type ApiOp, type PlanContext, type StateEffect, type SyncItem } from './plan.js'
import { saveState } from './state.js'
import { CONFLICT_RULE, PlanMismatchError, type AppTask, type ApplyResult, type SyncState, type TasksApi } from './types.js'

export interface ApplyHooks {
  /** Runs after the backup and before the first write. A test seam for concurrent edits. */
  afterBackup?: () => Promise<void>
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function applyEffect(state: SyncState, id: string, effect: StateEffect, response: AppTask | null): void {
  if (effect.kind === 'drop') {
    delete state.entries[id]
    if (effect.detachTaskId) state.detached[effect.detachTaskId] = id
    return
  }
  const taskId = response ? response.id : effect.taskId
  if (!taskId) return
  state.entries[id] = {
    taskId,
    file: effect.file,
    fields: effect.fields,
    appCompletedAt: response ? response.completed_at : effect.appCompletedAt,
  }
  delete state.detached[taskId]
}

function runOp(api: TasksApi, op: ApiOp): Promise<AppTask> {
  return op.kind === 'create' ? api.createTask(op.input) : api.updateTask(op.taskId, op.patch)
}

function opLabel(op: ApiOp): string {
  return op.kind === 'create' ? 'create' : op.action
}

export async function applyPlan(ctx: PlanContext, planId: string, hooks: ApplyHooks = {}): Promise<ApplyResult> {
  const computed = await computePlan(ctx)
  const { plan, vault, writes, items } = computed
  if (plan.planId !== planId) throw new PlanMismatchError(planId, plan.planId)

  const result: ApplyResult = {
    status: 'nothing-to-do',
    planId,
    conflictRule: CONFLICT_RULE,
    backupDir: null,
    filesWritten: [],
    filesAborted: [],
    appChangesApplied: 0,
    appChangesNotRun: 0,
    apiError: null,
    stateError: null,
    conflicts: plan.conflicts,
    removedFromVault: plan.removedFromVault,
    deletedInApp: plan.deletedInApp,
  }
  if (plan.empty) return result

  await assertStateDirSafe(vault)
  result.backupDir = await backupFiles(vault, writes.map((w) => w.rel), ctx.now())
  await hooks.afterBackup?.()

  const aborted = new Set<string>()
  for (const write of writes) {
    try {
      const outcome = await writeIfUnchanged(join(vault, write.rel), write.expectedHash, write.content)
      if (outcome.written) {
        result.filesWritten.push(write.rel)
      } else {
        aborted.add(write.rel)
        result.filesAborted.push({ file: write.rel, reason: outcome.reason })
      }
    } catch (err) {
      aborted.add(write.rel)
      result.filesAborted.push({ file: write.rel, reason: errorMessage(err) })
    }
  }

  const state: SyncState = structuredClone(computed.state)
  const blocked = (item: SyncItem) => item.file !== null && aborted.has(item.file)

  for (const item of items) {
    if (!item.op && !blocked(item)) applyEffect(state, item.id, item.effect, null)
  }

  for (const item of items) {
    if (!item.op) continue
    if (blocked(item) || result.apiError) {
      result.appChangesNotRun++
      continue
    }
    try {
      const response = await runOp(ctx.api, item.op)
      applyEffect(state, item.id, item.effect, response)
      result.appChangesApplied++
    } catch (err) {
      result.apiError = { action: opLabel(item.op), id: item.id, message: errorMessage(err) }
      result.appChangesNotRun++
    }
  }

  try {
    await saveState(vault, state)
  } catch (err) {
    result.stateError = errorMessage(err)
  }

  const clean = !result.apiError && !result.stateError && result.filesAborted.length === 0
  result.status = clean ? 'applied' : 'partial'
  return result
}
