// Runs a plan or apply for a connected vault, chosen by name and nothing else.
import { applyPlan, type ApplyHooks } from './apply.js'
import { assertValidName, findConnection, type ConfigEnv } from './config.js'
import { computePlan, type PlanContext } from './plan.js'
import type { ApplyResult, Connection, Plan, TasksApi } from './types.js'

export interface SessionOptions extends ConfigEnv {
  api: TasksApi
  now?: () => Date
  /** One-run override of the connection's saved setting. */
  noImportAppTasks?: boolean
}

async function contextFor(name: string, options: SessionOptions): Promise<PlanContext> {
  assertValidName(name)
  const saved = await findConnection(name, options)
  const connection: Connection = options.noImportAppTasks ? { ...saved, importAppTasks: false } : saved
  return { connection, api: options.api, now: options.now ?? (() => new Date()) }
}

export async function planVault(name: string, options: SessionOptions): Promise<Plan> {
  return (await computePlan(await contextFor(name, options))).plan
}

export async function applyVault(
  name: string,
  planId: string,
  options: SessionOptions,
  hooks?: ApplyHooks,
): Promise<ApplyResult> {
  return applyPlan(await contextFor(name, options), planId, hooks)
}
