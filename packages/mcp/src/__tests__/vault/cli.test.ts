import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELP, runCli, type CliIo } from '../../vault/cli.js'
import { configDir, connectVault, listConnections } from '../../vault/config.js'
import { CONFLICT_RULE } from '../../vault/types.js'
import { FakeApi, NOW, idIn, tempDir } from './helpers.js'

async function harness() {
  const vault = await tempDir()
  await mkdir(join(vault, '.obsidian'))
  await mkdir(join(vault, 'Tasks'))
  const config = await tempDir()
  const api = new FakeApi()
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    env: { MEOWLENDAR_CONFIG_DIR: config },
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    createApi: () => api,
    now: () => NOW,
  }
  const run = async (...argv: string[]) => {
    out.length = 0
    err.length = 0
    const code = await runCli(argv, io)
    return { code, out: out.join(''), err: err.join('') }
  }
  const connect = (name = 'work') => run('connect', '--name', name, '--vault', vault, '--folder', 'Tasks')
  return { vault, config, api, io, run, connect }
}

describe('--help', () => {
  it.each([[['--help']], [['-h']], [[]]])('prints usage for %j, with no key needed', async (argv) => {
    const h = await harness()
    h.io.createApi = () => {
      throw new Error('should not be called')
    }
    const { code, out } = await h.run(...argv)
    expect(code).toBe(0)
    expect(out).toBe(HELP)
  })

  it('states the conflict rule, the dry run, backups, and the supported format', () => {
    expect(HELP).toContain(CONFLICT_RULE)
    expect(HELP).toContain('writes nothing')
    expect(HELP).toContain('.meowlendar/backups')
    expect(HELP).toContain('any\nObsidian vault using the Obsidian Tasks plugin format')
    for (const usage of ['connect --name', 'list', 'disconnect --name', 'plan --name', 'apply --name', '--no-import-app-tasks']) {
      expect(HELP).toContain(usage)
    }
  })

  it('uses no em or en dashes', () => {
    expect(HELP).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('connect', () => {
  it('validates and saves the config with mode 600', async () => {
    const h = await harness()
    const { code, out } = await h.connect()
    expect(code).toBe(0)
    expect(out).toContain('Connected "work"')
    const file = join(h.config, 'vaults.json')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(file, 'utf8')).vaults).toEqual([
      { name: 'work', vault: h.vault, folder: 'Tasks', importAppTasks: true },
    ])
  })

  it('tightens a config file that was left readable', async () => {
    const h = await harness()
    await writeFile(join(h.config, 'vaults.json'), JSON.stringify({ version: 1, vaults: [] }), { mode: 0o644 })
    await h.connect()
    expect((await stat(join(h.config, 'vaults.json'))).mode & 0o777).toBe(0o600)
  })

  it('creates the config folder when it does not exist yet', async () => {
    const h = await harness()
    const nested = join(h.config, 'a', 'b')
    h.io.env = { MEOWLENDAR_CONFIG_DIR: nested }
    expect((await h.connect()).code).toBe(0)
    expect((await stat(join(nested, 'vaults.json'))).isFile()).toBe(true)
  })

  it('defaults to ~/.config/meowlendar', () => {
    expect(configDir({ env: {}, home: '/somewhere' })).toBe('/somewhere/.config/meowlendar')
  })

  it('uses the configured default path when the env var is unset', async () => {
    const home = await tempDir()
    const vault = await tempDir()
    await mkdir(join(vault, '.obsidian'))
    await connectVault({ name: 'work', vault, folder: '.', importAppTasks: true }, { env: {}, home })
    expect((await stat(join(home, '.config/meowlendar/vaults.json'))).isFile()).toBe(true)
    expect(await listConnections({ env: {}, home })).toHaveLength(1)
  })

  it('saves --no-import-app-tasks', async () => {
    const h = await harness()
    await h.run('connect', '--name', 'work', '--vault', h.vault, '--folder', 'Tasks', '--no-import-app-tasks')
    expect((await listConnections(h.io))[0]?.importAppTasks).toBe(false)
  })

  it.each([['--name'], ['--vault'], ['--folder']])('requires %s', async (flag) => {
    const h = await harness()
    const args = ['--name', 'work', '--vault', h.vault, '--folder', 'Tasks']
    args.splice(args.indexOf(flag), 2)
    const { code, err } = await h.run('connect', ...args)
    expect(code).toBe(2)
    expect(err).toContain(`${flag} is required`)
  })

  it.each(['a:b', '../up', '.hidden', 'has space', 'a/b', '', 'x'.repeat(65)])('refuses the name %j', async (name) => {
    const h = await harness()
    const { code } = await h.run('connect', '--name', name, '--vault', h.vault, '--folder', 'Tasks')
    expect(code).not.toBe(0)
    expect(await listConnections(h.io)).toEqual([])
  })

  it('refuses a bad folder and saves nothing', async () => {
    const h = await harness()
    const { code, err } = await h.run('connect', '--name', 'work', '--vault', h.vault, '--folder', '../x')
    expect(code).toBe(1)
    expect(err).toContain('..')
    expect(await listConnections(h.io)).toEqual([])
  })

  it('refuses a vault with no .obsidian', async () => {
    const h = await harness()
    await rm(join(h.vault, '.obsidian'), { recursive: true })
    const { code, err } = await h.connect()
    expect(code).toBe(1)
    expect(err).toContain('.obsidian')
  })

  it('refuses a name that is taken, and a vault that is already connected', async () => {
    const h = await harness()
    await h.connect()
    expect((await h.connect()).err).toContain('already connected')
    expect((await h.connect('second')).err).toContain('already connected as "work"')
  })
})

describe('list and disconnect', () => {
  it('lists connected vaults', async () => {
    const h = await harness()
    expect((await h.run('list')).out).toContain('No vaults connected')
    await h.connect()
    expect((await h.run('list')).out).toContain(`work: ${h.vault}, folder Tasks, imports app tasks`)
  })

  it('disconnect removes the entry and leaves the vault alone', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a 🆔 x1\n')
    const { code } = await h.run('disconnect', '--name', 'work')
    expect(code).toBe(0)
    expect(await listConnections(h.io)).toEqual([])
    expect(await readFile(join(h.vault, 'Tasks/a.md'), 'utf8')).toBe('- [ ] a 🆔 x1\n')
  })

  it('disconnect refuses an unknown name', async () => {
    const h = await harness()
    expect((await h.run('disconnect', '--name', 'nope')).code).toBe(1)
  })
})

describe('plan and apply', () => {
  it('plan shows the changes and the conflict rule, writing nothing', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] Buy milk\n')
    const { code, out } = await h.run('plan', '--name', 'work')
    expect(code).toBe(0)
    expect(out).toContain('Plan ID:')
    expect(out).toContain('Buy milk')
    expect(out).toContain(`Conflict rule: ${CONFLICT_RULE}`)
    expect(out).toContain('Nothing has been written')
    expect(out).toMatch(/meowlendar-vault apply --name work --plan [0-9a-f]{32}/)
    expect(await readFile(join(h.vault, 'Tasks/a.md'), 'utf8')).toBe('- [ ] Buy milk\n')
    expect(h.api.writes).toBe(0)
  })

  it('plan --json is the plan as data', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] Buy milk\n')
    const plan = JSON.parse((await h.run('plan', '--name', 'work', '--json')).out)
    expect(plan.planId).toMatch(/^[0-9a-f]{32}$/)
    expect(plan.appChanges[0].action).toBe('create')
    expect(plan.conflicts).toEqual([])
    expect(plan.conflictRule).toBe(CONFLICT_RULE)
  })

  it('apply takes the plan ID and a second plan is empty', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] Buy milk\n')
    const { planId } = JSON.parse((await h.run('plan', '--name', 'work', '--json')).out)
    const applied = await h.run('apply', '--name', 'work', '--plan', planId)
    expect(applied.code).toBe(0)
    expect(applied.out).toContain('Applied.')
    expect(applied.out).toContain('.meowlendar/backups/')
    expect(h.api.only().vault_ref).toBe(`work:${idIn(await readFile(join(h.vault, 'Tasks/a.md'), 'utf8'))}`)
    const again = await h.run('plan', '--name', 'work')
    expect(again.out).toContain('Nothing to do')
  })

  it('there is no way to apply without a plan ID', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    const { code, err } = await h.run('apply', '--name', 'work')
    expect(code).toBe(2)
    expect(err).toContain('--plan is required')
    expect(h.api.writes).toBe(0)
  })

  it('a stale plan ID is refused with a clear message', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    const { planId } = JSON.parse((await h.run('plan', '--name', 'work', '--json')).out)
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] b\n')
    const { code, err } = await h.run('apply', '--name', 'work', '--plan', planId)
    expect(code).toBe(1)
    expect(err).toContain('Nothing was written')
    expect(h.api.writes).toBe(0)
  })

  it('--no-import-app-tasks has to be on both plan and apply', async () => {
    const h = await harness()
    await h.connect()
    h.api.seed({ title: 'From app' })
    const { planId } = JSON.parse((await h.run('plan', '--name', 'work', '--json', '--no-import-app-tasks')).out)
    expect((await h.run('apply', '--name', 'work', '--plan', planId)).code).toBe(1)
    expect((await h.run('apply', '--name', 'work', '--plan', planId, '--no-import-app-tasks')).code).toBe(0)
    await expect(stat(join(h.vault, 'Tasks/Meowlendar.md'))).rejects.toThrow()
  })

  it('a partial apply exits 1 and says what happened', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    const { planId } = JSON.parse((await h.run('plan', '--name', 'work', '--json')).out)
    h.api.armFailure(1)
    const { code, out } = await h.run('apply', '--name', 'work', '--plan', planId)
    expect(code).toBe(1)
    expect(out).toContain('Applied in part')
    expect(out).toContain('Rate limit exceeded')
  })

  it('reports a missing API key through createApi without touching anything', async () => {
    const h = await harness()
    await h.connect()
    await writeFile(join(h.vault, 'Tasks/a.md'), '- [ ] a\n')
    h.io.createApi = () => {
      throw new Error('MEOWLENDAR_API_KEY is required.')
    }
    const { code, err } = await h.run('plan', '--name', 'work')
    expect(code).toBe(1)
    expect(err).toContain('MEOWLENDAR_API_KEY')
  })

  it.each([
    [['plan', '--name', 'work', '--vault', '/elsewhere']],
    [['plan', '--name', 'work', '--folder', '../..']],
    [['apply', '--name', 'work', '--plan', 'abc', '--vault', '/elsewhere']],
    [['list', '--json']],
  ])('refuses a flag the command does not take: %j', async (argv) => {
    const h = await harness()
    await h.connect()
    const { code, err } = await h.run(...argv)
    expect(code).toBe(2)
    expect(err).toContain('does not take')
    expect(h.api.reads).toBe(0)
  })

  it('refuses an unknown vault name and an unknown flag', async () => {
    const h = await harness()
    expect((await h.run('plan', '--name', 'nope')).err).toContain('No vault named "nope"')
    expect((await h.run('plan', '--nope')).code).toBe(2)
    expect((await h.run('explode')).code).toBe(2)
  })
})
