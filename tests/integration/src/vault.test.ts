import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { APP, createUser, type TestUser } from './helpers'

// The vault side runs only on throwaway folders under the system temp directory.
const run = promisify(execFile)
const CLI = join(new URL('../../..', import.meta.url).pathname, 'packages/mcp/dist/vault-cli.js')
const MCP = process.env.MEOW_MCP_ENTRY as string
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'meow-vault-tests-')))

interface Plan {
  planId: string
  empty: boolean
  vaultChanges: unknown[]
  appChanges: unknown[]
  conflicts: { field?: string }[]
  removedFromVault: unknown[]
  deletedInApp: unknown[]
}
interface Task {
  id: string
  title: string
  status: string
  importance: string
  due_date: string | null
  completed_at: string | null
  vault_ref: string | null
}

interface Env {
  user: TestUser
  vault: string
  notes: string
  name: string
  cli: (...args: string[]) => Promise<string>
  plan: () => Promise<Plan>
  apply: (plan?: Plan) => Promise<{ status: string; backupDir: string | null; filesWritten: string[] }>
  tasks: () => Promise<Task[]>
}

let counter = 0

async function setup(lines: string): Promise<Env> {
  const user = await createUser('vault')
  const name = `v${++counter}`
  const vault = mkdtempSync(join(ROOT, 'vault-'))
  expect(vault.startsWith(ROOT)).toBe(true)
  mkdirSync(join(vault, '.obsidian'))
  mkdirSync(join(vault, 'Tasks'))
  const notes = join(vault, 'Tasks', 'todo.md')
  writeFileSync(notes, lines)
  const env = {
    ...process.env,
    MEOWLENDAR_API_KEY: user.apiKey,
    MEOWLENDAR_API_URL: APP,
    MEOWLENDAR_CONFIG_DIR: join(vault, '.test-config'),
  }
  const cli = async (...args: string[]) => (await run('node', [CLI, ...args], { env })).stdout
  await cli('connect', '--name', name, '--vault', vault, '--folder', 'Tasks')
  const plan = async () => JSON.parse(await cli('plan', '--name', name, '--json')) as Plan
  const apply = async (given?: Plan) => {
    const p = given ?? (await plan())
    // A partial apply exits 1 but still reports what it did.
    const out = await cli('apply', '--name', name, '--plan', p.planId, '--json').catch((err: { stdout?: string }) => {
      if (err.stdout) return err.stdout
      throw err
    })
    return JSON.parse(out) as Awaited<ReturnType<Env['apply']>>
  }
  const tasks = async () => {
    const res = await user.api('/api/tasks?limit=200')
    return ((await res.json()) as { items: Task[] }).items
  }
  return { user, vault, notes, name, cli, plan, apply, tasks }
}

describe('the 2ndBrain link against the real API, on temp vaults', () => {
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

  it('plans without writing anything', async () => {
    const before = '- [ ] Write the plan ⏫ 📅 2030-02-01\nJust a note\n'
    const v = await setup(before)
    const plan = await v.plan()
    expect(plan.empty).toBe(false)
    expect(readFileSync(v.notes, 'utf8')).toBe(before)
    expect(await v.tasks()).toEqual([])
    expect(existsSync(join(v.vault, '.meowlendar', 'backups'))).toBe(false)
  })

  it('applies, backs up first, and a second run has nothing to do', async () => {
    const before = '- [ ] Write the plan ⏫ 📅 2030-02-01\nJust a note\n- [x] Old thing ✅ 2029-12-01\n'
    const v = await setup(before)
    const result = await v.apply()
    expect(result.status).toBe('applied')

    const after = readFileSync(v.notes, 'utf8')
    expect(after).toMatch(/- \[ \] Write the plan ⏫ 📅 2030-02-01 🆔 mw-[0-9a-f]{8}/)
    expect(after).toContain('Just a note')
    expect(readFileSync(join(v.vault, result.backupDir as string, 'Tasks', 'todo.md'), 'utf8')).toBe(before)

    const tasks = await v.tasks()
    const plan = tasks.find((t) => t.title === 'Write the plan')!
    expect(plan).toMatchObject({ importance: 'high', due_date: '2030-02-01', status: 'backlog' })
    expect(plan.vault_ref).toMatch(new RegExp(`^${v.name}:mw-`))

    // The completion date in the vault survives, not today's date.
    const old = tasks.find((t) => t.title === 'Old thing')!
    expect(old.status).toBe('done')
    expect(old.completed_at).toContain('2029-12-01')

    const again = await v.plan()
    expect(again.empty).toBe(true)
  })

  it('keeps an existing 🆔 byte for byte', async () => {
    const v = await setup('- [ ] Has an id 📅 2030-02-01 🆔 m-1a2b3c4d\n')
    await v.apply()
    expect(readFileSync(v.notes, 'utf8')).toBe('- [ ] Has an id 📅 2030-02-01 🆔 m-1a2b3c4d\n')
    expect((await v.tasks())[0]!.vault_ref).toBe(`${v.name}:m-1a2b3c4d`)
  })

  it('carries a vault edit to the app, and an app edit to the vault', async () => {
    const v = await setup('- [ ] First title 📅 2030-02-01\n')
    await v.apply()
    writeFileSync(v.notes, readFileSync(v.notes, 'utf8').replace('First title', 'Second title').replace('2030-02-01', '2030-03-01'))
    await v.apply()
    const task = (await v.tasks())[0]!
    expect(task).toMatchObject({ title: 'Second title', due_date: '2030-03-01' })

    const done = await v.user.api(`/api/tasks/${task.id}/complete`, { method: 'POST' })
    expect(done.status).toBe(200)
    await v.user.api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Third title' }) })
    await v.apply()
    const line = readFileSync(v.notes, 'utf8')
    expect(line).toContain('Third title')
    expect(line).toMatch(/^- \[x\] /)
    expect(line).toMatch(/✅ \d{4}-\d{2}-\d{2}/)
    expect((await v.plan()).empty).toBe(true)
  })

  it('lets the vault win a conflict, and lists what the app lost', async () => {
    const v = await setup('- [ ] Original\n')
    await v.apply()
    const task = (await v.tasks())[0]!
    writeFileSync(v.notes, readFileSync(v.notes, 'utf8').replace('Original', 'Vault version'))
    await v.user.api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'App version' }) })

    const plan = await v.plan()
    expect(plan.conflicts).toHaveLength(1)
    expect(JSON.stringify(plan.conflicts[0])).toContain('App version')
    await v.apply(plan)
    expect((await v.tasks())[0]!.title).toBe('Vault version')
    expect(readFileSync(v.notes, 'utf8')).toContain('Vault version')
  })

  it('appends a new app task, and leaves a schedule alone', async () => {
    const v = await setup('- [ ] From the vault\n')
    await v.apply()
    const created = await v.user.api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'From the app', importance: 'highest', scheduled_start: '2030-01-08T10:00:00.000Z', scheduled_end: '2030-01-08T11:00:00.000Z' }),
    })
    const task = (await created.json()) as Task & { scheduled_start: string }
    await v.apply()
    const inbox = readFileSync(join(v.vault, 'Tasks', 'Meowlendar.md'), 'utf8')
    expect(inbox).toContain('From the app')
    expect(inbox).toContain('🔺')

    const after = (await (await v.user.api(`/api/tasks/${task.id}`)).json()) as Task & { scheduled_start: string }
    expect(new Date(after.scheduled_start).toISOString()).toBe('2030-01-08T10:00:00.000Z')
    expect((await v.plan()).empty).toBe(true)
  })

  it('never deletes: a removed line unlinks, a deleted task cancels the line', async () => {
    const v = await setup('- [ ] Remove this line\n- [ ] Delete this task\n')
    await v.apply()
    const tasks = await v.tasks()
    const doomed = tasks.find((t) => t.title === 'Delete this task')!
    const keeps = tasks.find((t) => t.title === 'Remove this line')!

    const lines = readFileSync(v.notes, 'utf8').split('\n')
    writeFileSync(v.notes, lines.filter((l) => !l.includes('Remove this line')).join('\n'))
    await v.user.api(`/api/tasks/${doomed.id}`, { method: 'DELETE' })

    const plan = await v.plan()
    expect(plan.removedFromVault).toHaveLength(1)
    expect(plan.deletedInApp).toHaveLength(1)
    await v.apply(plan)

    const kept = (await (await v.user.api(`/api/tasks/${keeps.id}`)).json()) as Task
    expect(kept.title).toBe('Remove this line')
    expect(kept.vault_ref).toBeNull()
    expect(readFileSync(v.notes, 'utf8')).toMatch(/- \[-\] Delete this task.*❌ \d{4}-\d{2}-\d{2}/)
  })

  it('refuses a plan that no longer matches', async () => {
    const v = await setup('- [ ] Something\n')
    const plan = await v.plan()
    writeFileSync(v.notes, '- [ ] Something else\n')
    await expect(v.apply(plan)).rejects.toThrow()
    expect(await v.tasks()).toEqual([])
    expect(readFileSync(v.notes, 'utf8')).toBe('- [ ] Something else\n')
  })

  describe('paths', () => {
    it('refuses a folder outside the vault, a vault with no .obsidian, and a symlink out', async () => {
      const v = await setup('- [ ] x\n')
      const outside = mkdtempSync(join(ROOT, 'outside-'))
      writeFileSync(join(outside, 'secret.md'), '- [ ] Do not touch\n')
      const connect = (folder: string, vault = v.vault) => v.cli('connect', '--name', `p${++counter}`, '--vault', vault, '--folder', folder)

      await expect(connect('../')).rejects.toThrow()
      await expect(connect(outside)).rejects.toThrow()
      await expect(connect('.obsidian')).rejects.toThrow()
      await expect(connect('.', outside)).rejects.toThrow()

      symlinkSync(outside, join(v.vault, 'Tasks', 'linked'))
      symlinkSync(join(outside, 'secret.md'), join(v.vault, 'Tasks', 'linked.md'))
      await v.apply()
      expect(readFileSync(join(outside, 'secret.md'), 'utf8')).toBe('- [ ] Do not touch\n')
      expect((await v.tasks()).map((t) => t.title)).toEqual(['x'])
    })
  })

  describe('vault_ref in the real database', () => {
    it('is unique per user, not across users, and a duplicate is a 409', async () => {
      const a = await createUser('ref-a')
      const b = await createUser('ref-b')
      const body = JSON.stringify({ title: 'x', vault_ref: 'work:abc' })
      expect((await a.api('/api/tasks', { method: 'POST', body })).status).toBe(201)
      expect((await b.api('/api/tasks', { method: 'POST', body })).status).toBe(201)
      expect((await a.api('/api/tasks', { method: 'POST', body })).status).toBe(409)

      const other = (await (await a.api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'y' }) })).json()) as Task
      const patch = await a.api(`/api/tasks/${other.id}`, { method: 'PATCH', body: JSON.stringify({ vault_ref: 'work:abc' }) })
      expect(patch.status).toBe(409)
      expect((await a.api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'z', vault_ref: 'bad ref!' }) })).status).toBe(422)
    })
  })

  describe('over MCP', () => {
    let client: Client
    let v: Env

    beforeAll(async () => {
      v = await setup('- [ ] Through the MCP\n')
      client = new Client({ name: 'vault-test', version: '1' })
      await client.connect(
        new StdioClientTransport({
          command: 'node',
          args: [MCP],
          env: {
            ...process.env,
            MEOWLENDAR_API_KEY: v.user.apiKey,
            MEOWLENDAR_API_URL: APP,
            MEOWLENDAR_CONFIG_DIR: join(v.vault, '.test-config'),
          } as Record<string, string>,
        }),
      )
    })
    afterAll(() => client.close())

    it('plans and applies by vault name', async () => {
      const list = await client.callTool({ name: 'vault_list', arguments: {} })
      expect(JSON.stringify(list.content)).toContain(v.name)

      const planned = await client.callTool({ name: 'vault_plan', arguments: { name: v.name } })
      const plan = JSON.parse((planned.content as { text: string }[])[0]!.text) as Plan
      expect(plan.empty).toBe(false)
      expect(await v.tasks()).toEqual([])

      const applied = await client.callTool({ name: 'vault_apply', arguments: { name: v.name, plan_id: plan.planId } })
      expect(applied.isError).toBeFalsy()
      expect((await v.tasks()).map((t) => t.title)).toEqual(['Through the MCP'])
    })

    it('refuses an unknown vault name and a made-up plan', async () => {
      expect((await client.callTool({ name: 'vault_plan', arguments: { name: 'nope' } })).isError).toBe(true)
      expect((await client.callTool({ name: 'vault_apply', arguments: { name: v.name, plan_id: 'made-up' } })).isError).toBe(true)
    })

    it('takes no path argument, so a prompt cannot aim it elsewhere', async () => {
      const { tools } = await client.listTools()
      for (const tool of tools.filter((t) => t.name.startsWith('vault_'))) {
        const props = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {})
        expect(props.filter((p) => /path|folder|vault$/.test(p))).toEqual([])
      }
    })
  })

  it('finishes a large first sync across the API rate limit, with no duplicates', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => `- [ ] Bulk task ${i}`).join('\n') + '\n'
    const v = await setup(lines)
    const first = await v.apply()
    expect(['partial', 'applied']).toContain(first.status)

    await new Promise((r) => setTimeout(r, 61_000))
    const second = await v.apply()
    expect(second.status).toBe('applied')
    expect((await v.plan()).empty).toBe(true)

    const { data } = await v.user.client.from('tasks').select('title')
    const titles = (data ?? []).map((t) => t.title as string)
    expect(titles).toHaveLength(120)
    expect(new Set(titles).size).toBe(120)
  }, 180_000)
})
