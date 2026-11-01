import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveVaultPaths } from '../../vault/paths.js'
import { VaultError } from '../../vault/types.js'
import { setup, tempDir } from './helpers.js'

async function vaultDir(): Promise<string> {
  const vault = await tempDir()
  await mkdir(join(vault, '.obsidian'))
  await mkdir(join(vault, 'Tasks'))
  return vault
}

describe('resolveVaultPaths', () => {
  it('accepts a folder in a vault and returns real paths', async () => {
    const vault = await vaultDir()
    await expect(resolveVaultPaths(vault, 'Tasks')).resolves.toEqual({ vault, folder: 'Tasks', folderAbs: join(vault, 'Tasks') })
  })

  it('accepts the vault root as "." and tidies a folder path', async () => {
    const vault = await vaultDir()
    expect((await resolveVaultPaths(vault, '.')).folder).toBe('')
    expect((await resolveVaultPaths(vault, './Tasks/')).folder).toBe('Tasks')
  })

  it('refuses a vault with no .obsidian directory', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'Tasks'))
    await expect(resolveVaultPaths(dir, 'Tasks')).rejects.toThrow(/\.obsidian/)
  })

  it('refuses a .obsidian that is a file', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, '.obsidian'), 'x')
    await expect(resolveVaultPaths(dir, '.')).rejects.toThrow(/\.obsidian/)
  })

  it('refuses a vault that does not exist', async () => {
    const dir = await tempDir()
    await expect(resolveVaultPaths(join(dir, 'nope'), '.')).rejects.toThrow(/does not exist/)
  })

  it.each([
    ['..'],
    ['../outside'],
    ['Tasks/../..'],
    ['Tasks/../Tasks'],
    ['/etc'],
    ['.obsidian'],
    ['.meowlendar'],
    ['.git'],
    ['.GIT'],
    ['Tasks/.git/hooks'],
    ['Tasks\\..\\x'],
    [''],
    ['a\0b'],
  ])('refuses the folder %j', async (folder) => {
    const vault = await vaultDir()
    await expect(resolveVaultPaths(vault, folder)).rejects.toThrow(VaultError)
  })

  it('refuses a folder that does not exist', async () => {
    const vault = await vaultDir()
    await expect(resolveVaultPaths(vault, 'Missing')).rejects.toThrow(/does not exist/)
  })

  it('refuses a folder that is a symlink out of the vault', async () => {
    const vault = await vaultDir()
    const outside = await tempDir()
    await symlink(outside, join(vault, 'Escape'))
    await expect(resolveVaultPaths(vault, 'Escape')).rejects.toThrow(/outside the vault/)
  })

  it('refuses a folder under a symlink out of the vault', async () => {
    const vault = await vaultDir()
    const outside = await tempDir()
    await mkdir(join(outside, 'sub'))
    await symlink(outside, join(vault, 'Escape'))
    await expect(resolveVaultPaths(vault, 'Escape/sub')).rejects.toThrow(/outside the vault/)
  })

  it('refuses a folder that is a symlink into .obsidian', async () => {
    const vault = await vaultDir()
    await symlink(join(vault, '.obsidian'), join(vault, 'Sneaky'))
    await expect(resolveVaultPaths(vault, 'Sneaky')).rejects.toThrow(/\.obsidian/)
  })

  it('accepts a vault path that is itself a symlink, by its real location', async () => {
    const vault = await vaultDir()
    const holder = await tempDir()
    await symlink(vault, join(holder, 'link'))
    expect((await resolveVaultPaths(join(holder, 'link'), 'Tasks')).vault).toBe(vault)
  })
})

describe('symlinks during a sync', () => {
  it('skips and reports a file symlinked out of the vault, and never reads or writes it', async () => {
    const outside = await tempDir()
    const secret = join(outside, 'secret.md')
    await writeFile(secret, '- [ ] secret task\n')
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    await symlink(secret, h.path('Tasks/link.md'))

    const plan = await h.plan()
    expect(plan.skipped).toEqual([expect.objectContaining({ file: 'Tasks/link.md', reason: expect.stringContaining('outside the vault') })])
    await h.apply(plan.planId)
    expect(h.api.only().title).toBe('a')
    expect(await readFile(secret, 'utf8')).toBe('- [ ] secret task\n')
  })

  it('skips and reports a directory symlinked out of the vault', async () => {
    const outside = await tempDir()
    await writeFile(join(outside, 'x.md'), '- [ ] outside\n')
    const h = await setup()
    await symlink(outside, h.path('Tasks/linked-dir'))
    const plan = await h.plan()
    expect(plan.skipped[0]).toMatchObject({ file: 'Tasks/linked-dir' })
    expect(plan.empty).toBe(true)
  })

  it('skips and reports a broken symlink', async () => {
    const h = await setup()
    await symlink(h.path('nowhere.md'), h.path('Tasks/broken.md'))
    expect((await h.plan()).skipped[0]?.reason).toContain('Broken')
  })

  it('reads a file linked from inside the vault once, at its real path, and keeps the link', async () => {
    const h = await setup({ 'Other/real.md': '- [ ] real\n' })
    await symlink(h.path('Other/real.md'), h.path('Tasks/link.md'))
    await h.sync()
    expect((await lstat(h.path('Tasks/link.md'))).isSymbolicLink()).toBe(true)
    expect(await readFile(h.path('Other/real.md'), 'utf8')).toMatch(/🆔 mw-/)
    expect(h.api.only().title).toBe('real')
  })

  it('survives a symlink loop', async () => {
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    await symlink(h.path('Tasks'), h.path('Tasks/loop'))
    await h.sync()
    expect(h.api.only().title).toBe('a')
  })

  it('will not follow a link into .obsidian', async () => {
    const h = await setup({ '.obsidian/notes.md': '- [ ] config\n' })
    await symlink(h.path('.obsidian/notes.md'), h.path('Tasks/link.md'))
    const plan = await h.plan()
    expect(plan.skipped[0]?.reason).toContain('protected')
    expect(plan.empty).toBe(true)
  })

  it('will not import through a symlinked Meowlendar.md', async () => {
    const outside = await tempDir()
    const target = join(outside, 'target.md')
    await writeFile(target, 'mine\n')
    const h = await setup()
    await symlink(target, h.path('Tasks/Meowlendar.md'))
    const task = h.api.seed({ title: 'From app' })
    const plan = await h.plan()
    expect(plan.vaultChanges).toEqual([])
    expect(plan.skipped.map((s) => s.reason).join()).toContain("can't take new lines")
    await h.apply(plan.planId)
    expect(await readFile(target, 'utf8')).toBe('mine\n')
    expect(h.api.tasks.get(task.id)?.vault_ref).toBeNull()
  })

  it('refuses when .meowlendar is a symlink, so backups can not be aimed out of the vault', async () => {
    const outside = await tempDir()
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    await symlink(outside, h.path('.meowlendar'))
    await expect(h.plan()).rejects.toThrow(/symlink/)
  })

  it('refuses when the state file or backups folder is a symlink', async () => {
    const outside = await tempDir()
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    await mkdir(h.path('.meowlendar'))
    await symlink(join(outside, 'state.json'), h.path('.meowlendar/sync-state.json'))
    await expect(h.plan()).rejects.toThrow(/symlink/)
    await rm(h.path('.meowlendar/sync-state.json'))
    await symlink(outside, h.path('.meowlendar/backups'))
    await expect(h.plan()).rejects.toThrow(/symlink/)
  })

  it('re-checks the folder on every run, in case it turned into a symlink', async () => {
    const outside = await tempDir()
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    await rm(h.path('Tasks'), { recursive: true })
    await symlink(outside, h.path('Tasks'))
    await expect(h.plan()).rejects.toThrow(/outside the vault/)
  })

  it('refuses when the .obsidian directory has gone away', async () => {
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    await rm(h.path('.obsidian'), { recursive: true })
    await expect(h.plan()).rejects.toThrow(/\.obsidian/)
  })

  it('aborts a write when the file became a symlink after the plan', async () => {
    const outside = await tempDir()
    const target = join(outside, 'x.md')
    await writeFile(target, '- [ ] a\n')
    const h = await setup({ 'Tasks/a.md': '- [ ] a\n' })
    const { planId } = await h.plan()
    const result = await h.apply(planId, {
      afterBackup: async () => {
        await rm(h.path('Tasks/a.md'))
        await symlink(target, h.path('Tasks/a.md'))
      },
    })
    expect(result.filesAborted[0]?.reason).toContain('no longer a regular file')
    expect(await readFile(target, 'utf8')).toBe('- [ ] a\n')
    expect(h.api.tasks.size).toBe(0)
  })

  it('skips a file that is not valid UTF-8 rather than corrupting it', async () => {
    const h = await setup()
    const bytes = Buffer.concat([Buffer.from('- [ ] a '), Buffer.from([0xff, 0xfe]), Buffer.from('\n')])
    await writeFile(h.path('Tasks/bad.md'), bytes)
    const plan = await h.plan()
    expect(plan.skipped[0]?.reason).toContain('UTF-8')
    expect(plan.empty).toBe(true)
  })

  it('only reads .md, not .MD or .markdown', async () => {
    const h = await setup({ 'Tasks/a.MD': '- [ ] no\n', 'Tasks/b.markdown': '- [ ] no\n', 'Tasks/c.md.bak': '- [ ] no\n' })
    expect((await h.plan()).empty).toBe(true)
  })

  it('never looks in hidden folders of a whole-vault sync', async () => {
    const h = await setup({ '.git/x.md': '- [ ] a\n', '.trash/y.md': '- [ ] b\n', '.obsidian/z.md': '- [ ] c\n', '.meowlendar/w.md': '- [ ] d\n' }, { folder: '.' })
    expect((await h.plan()).empty).toBe(true)
  })
})
