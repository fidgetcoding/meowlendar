// Temp vaults and an in-memory stand-in for the app. Everything lives under os.tmpdir().
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { applyPlan, type ApplyHooks } from '../../vault/apply.js'
import { computePlan, type PlanContext } from '../../vault/plan.js'
import type { AppTask, ApplyResult, Connection, Plan, TaskCreateInput, TaskPatch, TasksApi } from '../../vault/types.js'

const cleanups: string[] = []

afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true })
})

export async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'meow-vault-test-')))
  cleanups.push(dir)
  return dir
}

export const NOW = new Date(2026, 5, 15, 12)
export const TODAY = '2026-06-15'

export class FakeApi implements TasksApi {
  tasks = new Map<string, AppTask>()
  writes = 0
  reads = 0
  private nextId = 1
  /** Throws on the write with this 1-based number, counted from now. */
  failOnWrite: number | null = null
  private writesSinceArm = 0

  armFailure(onWrite: number): void {
    this.failOnWrite = onWrite
    this.writesSinceArm = 0
  }

  private maybeFail(): void {
    if (this.failOnWrite === null) return
    this.writesSinceArm++
    if (this.writesSinceArm === this.failOnWrite) {
      this.failOnWrite = null
      throw new Error('Rate limit exceeded')
    }
  }

  private assertRefFree(ref: string | null | undefined, selfId: string | null): void {
    if (!ref) return
    for (const task of this.tasks.values()) {
      if (task.vault_ref === ref && task.id !== selfId) throw new Error('Another task already uses this vault_ref')
    }
  }

  seed(fields: Partial<AppTask> & { title: string }): AppTask {
    const id = fields.id ?? `task-${String(this.nextId++).padStart(3, '0')}`
    const task: AppTask = {
      status: 'backlog',
      importance: 'normal',
      due_date: null,
      completed_at: null,
      vault_ref: null,
      created_at: `2026-01-01T00:00:${String(this.tasks.size).padStart(2, '0')}.000Z`,
      ...fields,
      id,
    }
    this.tasks.set(id, task)
    return { ...task }
  }

  byRef(ref: string): AppTask | undefined {
    return [...this.tasks.values()].find((t) => t.vault_ref === ref)
  }

  only(): AppTask {
    const all = [...this.tasks.values()]
    if (all.length !== 1) throw new Error(`Expected one task, found ${all.length}`)
    return all[0] as AppTask
  }

  async listTasks(): Promise<AppTask[]> {
    this.reads++
    return [...this.tasks.values()].map((t) => ({ ...t }))
  }

  async createTask(input: TaskCreateInput): Promise<AppTask> {
    this.maybeFail()
    this.assertRefFree(input.vault_ref, null)
    this.writes++
    const completed = input.status === 'done' ? (input.completed_at ?? new Date().toISOString()) : null
    const { completed_at: _dropped, ...rest } = input
    return this.seed({ ...rest, completed_at: completed })
  }

  /** Same completed_at rules as PATCH /api/tasks/:id. */
  async updateTask(id: string, patch: TaskPatch): Promise<AppTask> {
    this.maybeFail()
    const task = this.tasks.get(id)
    if (!task) throw new Error('Task not found')
    this.assertRefFree(patch.vault_ref, id)
    this.writes++
    const next: AppTask = { ...task, ...patch, completed_at: task.completed_at }
    const status = patch.status ?? task.status
    if (status === 'done') {
      if (task.status !== 'done') next.completed_at = patch.completed_at ?? new Date().toISOString()
      else if (patch.completed_at) next.completed_at = patch.completed_at
    } else {
      next.completed_at = null
    }
    this.tasks.set(id, next)
    return { ...next }
  }
}

export interface Harness {
  vault: string
  api: FakeApi
  connection: Connection
  ctx: PlanContext
  path: (rel: string) => string
  read: (rel: string) => Promise<string>
  write: (rel: string, content: string) => Promise<void>
  plan: () => Promise<Plan>
  apply: (planId: string, hooks?: ApplyHooks) => Promise<ApplyResult>
  /** Plan then apply, the way a person would. */
  sync: () => Promise<ApplyResult>
  state: () => Promise<Record<string, unknown>>
}

export interface SetupOptions {
  folder?: string
  name?: string
  importAppTasks?: boolean
  now?: () => Date
}

export async function setup(files: Record<string, string> = {}, options: SetupOptions = {}): Promise<Harness> {
  const vault = await tempDir()
  const folder = options.folder ?? 'Tasks'
  await mkdir(join(vault, '.obsidian'))
  await mkdir(join(vault, folder), { recursive: true })
  const path = (rel: string) => join(vault, rel)
  const write = async (rel: string, content: string) => {
    await mkdir(dirname(path(rel)), { recursive: true })
    await writeFile(path(rel), content)
  }
  for (const [rel, content] of Object.entries(files)) await write(rel, content)

  const api = new FakeApi()
  const connection: Connection = {
    name: options.name ?? 'work',
    vault,
    folder: folder === '.' ? '' : folder,
    importAppTasks: options.importAppTasks ?? true,
  }
  const ctx: PlanContext = { connection, api, now: options.now ?? (() => NOW) }
  const plan = async () => (await computePlan(ctx)).plan
  const apply = (planId: string, hooks?: ApplyHooks) => applyPlan(ctx, planId, hooks)
  return {
    vault,
    api,
    connection,
    ctx,
    path,
    read: (rel) => readFile(path(rel), 'utf8'),
    write,
    plan,
    apply,
    sync: async () => apply((await plan()).planId),
    state: async () => JSON.parse(await readFile(path('.meowlendar/sync-state.json'), 'utf8')) as Record<string, unknown>,
  }
}

/** The 🆔 on the first line that has one. */
export function idIn(text: string): string {
  const m = /🆔 (\S+)/.exec(text)
  if (!m?.[1]) throw new Error(`No id in: ${text}`)
  return m[1]
}

export const FILE = 'Tasks/a.md'

/** A vault with one line, already synced once. */
export async function synced(line: string) {
  const h = await setup({ [FILE]: `${line}\n` })
  await h.sync()
  const id = idIn(await h.read(FILE))
  return { ...h, id, taskId: h.api.only().id }
}
