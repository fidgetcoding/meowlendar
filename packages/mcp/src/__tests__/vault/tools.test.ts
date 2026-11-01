import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VAULT_REF_PATTERN } from '@poolendar/validators'
import { getVaultToolDefinitions, getVaultToolHandlers } from '../../tools/vault.js'
import { validateArgs } from '../../validate.js'
import { connectVault } from '../../vault/config.js'
import { VAULT_REF } from '../../vault/mapping.js'
import { FakeApi, NOW, tempDir } from './helpers.js'

async function harness() {
  const vault = await tempDir()
  await mkdir(join(vault, '.obsidian'))
  await mkdir(join(vault, 'Tasks'))
  const config = await tempDir()
  const env = { MEOWLENDAR_CONFIG_DIR: config }
  await connectVault({ name: 'work', vault, folder: 'Tasks', importAppTasks: true }, { env })
  const api = new FakeApi()
  const handlers = getVaultToolHandlers(api, { env, now: () => NOW })
  const call = (name: string, args: Record<string, unknown>) => {
    const handler = handlers[name]
    if (!handler) throw new Error(`No handler for ${name}`)
    return handler(args)
  }
  return { vault, api, handlers, call, env }
}

describe('vault tool definitions', () => {
  const tools = getVaultToolDefinitions()

  it('are vault_list, vault_plan, and vault_apply, with no connect tool', () => {
    expect(tools.map((t) => t.name)).toEqual(['vault_list', 'vault_plan', 'vault_apply'])
  })

  it('take names and plan IDs only, and accept nothing else', () => {
    const props = Object.fromEntries(tools.map((t) => [t.name, Object.keys(t.inputSchema.properties)]))
    expect(props).toEqual({ vault_list: [], vault_plan: ['name'], vault_apply: ['name', 'plan_id'] })
    for (const tool of tools) expect(tool.inputSchema.additionalProperties).toBe(false)
  })

  it('require their arguments in the runtime validator', () => {
    const plan = tools.find((t) => t.name === 'vault_apply')
    expect(validateArgs({}, plan?.inputSchema ?? {})).toEqual(['name is required', 'plan_id is required'])
    expect(validateArgs({ name: 'a', plan_id: '../../etc' }, plan?.inputSchema ?? {})).toContain('plan_id is not a valid id')
  })
})

describe('vault tool handlers', () => {
  it('vault_list shows connected vaults', async () => {
    const h = await harness()
    expect(JSON.parse(await h.call('vault_list', {}))).toEqual({
      vaults: [{ name: 'work', folder: 'Tasks', import_app_tasks: true }],
    })
  })

  it('vault_plan then vault_apply sync a vault, and a second plan is empty', async () => {
    const h = await harness()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    const plan = JSON.parse(await h.call('vault_plan', { name: 'work' }))
    expect(plan.conflictRule).toContain('the vault wins')
    expect(h.api.writes).toBe(0)
    const result = JSON.parse(await h.call('vault_apply', { name: 'work', plan_id: plan.planId }))
    expect(result.status).toBe('applied')
    expect(h.api.only().title).toBe('a')
    expect(await readFile(join(h.vault, 'Tasks/a.md'), 'utf8')).toMatch(/🆔 mw-/)
    expect(JSON.parse(await h.call('vault_plan', { name: 'work' })).empty).toBe(true)
  })

  it('vault_apply refuses a plan ID that no longer matches', async () => {
    const h = await harness()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    await expect(h.call('vault_apply', { name: 'work', plan_id: 'f'.repeat(32) })).rejects.toThrow(/no longer matches/)
    expect(h.api.writes).toBe(0)
  })

  it.each([
    ['nope'],
    ['constructor'],
    ['__proto__'],
    ['../../etc'],
    ['/etc/passwd'],
    ['WORK'],
    ['work/'],
  ])('refuse the vault name %s', async (name) => {
    const h = await harness()
    await expect(h.call('vault_plan', { name })).rejects.toThrow()
    await expect(h.call('vault_apply', { name, plan_id: 'abc' })).rejects.toThrow()
    expect(h.api.writes).toBe(0)
  })

  it.each([
    ['vault_list', { vault: '/etc' }],
    ['vault_plan', { name: 'work', vault: '/etc' }],
    ['vault_plan', { name: 'work', path: '/etc' }],
    ['vault_plan', { name: 'work', folder: '../..' }],
    ['vault_apply', { name: 'work', plan_id: 'abc', vault: '/etc' }],
    ['vault_apply', { name: 'work', plan_id: 'abc', folder: '../..' }],
  ])('%s refuses the path-like argument in %j', async (tool, args) => {
    const h = await harness()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    await expect(h.call(tool, args)).rejects.toThrow(/Unexpected argument/)
    expect(h.api.writes).toBe(0)
  })

  it('refuse a name that is not a string', async () => {
    const h = await harness()
    await expect(h.call('vault_plan', { name: 42 })).rejects.toThrow(/name is required/)
    await expect(h.call('vault_plan', {})).rejects.toThrow(/name is required/)
  })
})

describe('the ref format', () => {
  it('matches the API validator', () => {
    expect(VAULT_REF.source).toBe(VAULT_REF_PATTERN.source)
  })
})
