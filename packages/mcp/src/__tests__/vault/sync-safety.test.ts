import { chmod, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILE, idIn, setup, synced } from './helpers.js'

describe('backups', () => {
  it('copies every file about to change plus the state file, at the same relative path', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n', 'Tasks/sub/b.md': '- [ ] b\n', 'Tasks/untouched.md': 'words\n' })
    h.api.seed({ title: 'From app' })
    await h.sync()

    const beforeA = await h.read(FILE)
    const beforeImport = await h.read('Tasks/Meowlendar.md')
    const beforeState = await h.read('.meowlendar/sync-state.json')
    const aTask = h.api.byRef(`work:${idIn(beforeA)}`)
    h.api.tasks.set(aTask?.id as string, { ...(aTask as NonNullable<typeof aTask>), due_date: '2026-09-09' })
    h.api.seed({ title: 'Another' })

    const dir = (await h.sync()).backupDir as string
    expect(dir).toMatch(/^\.meowlendar\/backups\//)
    expect(await h.read(join(dir, FILE))).toBe(beforeA)
    expect(await h.read(join(dir, 'Tasks/Meowlendar.md'))).toBe(beforeImport)
    expect(await h.read(join(dir, '.meowlendar/sync-state.json'))).toBe(beforeState)
    await expect(stat(h.path(join(dir, 'Tasks/untouched.md')))).rejects.toThrow()
    await expect(stat(h.path(join(dir, 'Tasks/sub/b.md')))).rejects.toThrow()
    expect(await h.read(FILE)).not.toBe(beforeA)
  })

  it('gives two applies in the same instant separate folders', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    const first = await h.sync()
    await h.write(FILE, (await h.read(FILE)).replace('] a', '] b'))
    const second = await h.sync()
    expect(second.backupDir).not.toBe(first.backupDir)
  })

  it('holds the bytes from before the write', async () => {
    const original = '- [ ] a\n\n- [ ] b\r\n'
    const h = await setup({ [FILE]: original })
    const result = await h.sync()
    expect(await readFile(h.path(join(result.backupDir as string, FILE)), 'utf8')).toBe(original)
    expect(await h.read(FILE)).not.toBe(original)
  })

  it('a failed backup writes nothing at all', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    // A file where the backups folder has to go makes mkdir fail.
    await h.write('.meowlendar/backups', 'in the way')
    const { planId } = await h.plan()
    await expect(h.apply(planId)).rejects.toThrow()
    expect(await h.read(FILE)).toBe('- [ ] a\n')
    expect(h.api.writes).toBe(0)
    await expect(stat(h.path('.meowlendar/sync-state.json'))).rejects.toThrow()
  })

  it('leaves no temp files behind', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    await h.sync()
    expect(await readdir(h.path('Tasks'))).toEqual(['a.md'])
  })

  it('keeps the mode of a rewritten file', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    await chmod(h.path(FILE), 0o640)
    await h.sync()
    expect((await stat(h.path(FILE))).mode & 0o777).toBe(0o640)
  })
})

describe('a file edited while applying', () => {
  it('aborts that file and everything that depends on it, and the rest goes through', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n', 'Tasks/b.md': '- [ ] b\n' })
    const { planId } = await h.plan()
    const edited = '- [ ] a edited by hand\n'
    const result = await h.apply(planId, { afterBackup: () => h.write(FILE, edited) })
    expect(result.status).toBe('partial')
    expect(result.filesAborted).toEqual([{ file: FILE, reason: 'The file was edited since the plan.' }])
    expect(result.filesWritten).toEqual(['Tasks/b.md'])
    expect(await h.read(FILE)).toBe(edited)
    expect(h.api.only().title).toBe('b')

    expect((await h.sync()).status).toBe('applied')
    expect([...h.api.tasks.values()].map((t) => t.title).sort()).toEqual(['a edited by hand', 'b'])
    expect((await h.plan()).empty).toBe(true)
  })

  it('aborts when a new import file appears after the plan', async () => {
    const h = await setup()
    const task = h.api.seed({ title: 'From app' })
    const { planId } = await h.plan()
    const result = await h.apply(planId, { afterBackup: () => h.write('Tasks/Meowlendar.md', 'mine\n') })
    expect(result.filesAborted[0]?.file).toBe('Tasks/Meowlendar.md')
    expect(await h.read('Tasks/Meowlendar.md')).toBe('mine\n')
    expect(h.api.tasks.get(task.id)?.vault_ref).toBeNull()
  })

  it('aborts when the file is removed after the plan', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    const { planId } = await h.plan()
    const result = await h.apply(planId, { afterBackup: () => rm(h.path(FILE)) })
    expect(result.filesAborted[0]?.reason).toContain('removed')
    await expect(stat(h.path(FILE))).rejects.toThrow()
    expect(h.api.tasks.size).toBe(0)
  })
})

describe('partial failure converges on a re-run', () => {
  it('stops at the first API failure, reports it, and finishes next time', async () => {
    const h = await setup({ [FILE]: '- [ ] one\n- [ ] two\n- [ ] three\n' })
    h.api.armFailure(2)
    const result = await h.sync()
    expect(result.status).toBe('partial')
    expect(result.appChangesApplied).toBe(1)
    expect(result.appChangesNotRun).toBe(2)
    expect(result.apiError?.message).toBe('Rate limit exceeded')
    expect(h.api.tasks.size).toBe(1)
    const ids = (await h.read(FILE)).match(/mw-[0-9a-f]{8}/g)
    expect(ids).toHaveLength(3)

    const next = await h.sync()
    expect(next.status).toBe('applied')
    expect(next.appChangesApplied).toBe(2)
    expect(h.api.tasks.size).toBe(3)
    expect((await h.read(FILE)).match(/mw-[0-9a-f]{8}/g)).toEqual(ids)
    expect((await h.plan()).empty).toBe(true)
  })

  it('recovers when an update fails, with both sides changed', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, (await h.read(FILE)).replace('] a', '] renamed'))
    h.api.tasks.set(h.taskId, { ...h.api.only(), due_date: '2026-03-03' })
    h.api.armFailure(1)
    expect((await h.sync()).status).toBe('partial')
    expect(await h.read(FILE)).toContain('📅 2026-03-03')
    expect(h.api.only().title).toBe('a')

    const plan = await h.plan()
    expect(plan.conflicts).toEqual([])
    await h.apply(plan.planId)
    expect(h.api.only()).toMatchObject({ title: 'renamed', due_date: '2026-03-03' })
    expect((await h.plan()).empty).toBe(true)
  })

  it('an import whose link call failed does not duplicate the line or the task', async () => {
    const h = await setup()
    const task = h.api.seed({ title: 'From app' })
    h.api.armFailure(1)
    expect((await h.sync()).status).toBe('partial')
    const text = await h.read('Tasks/Meowlendar.md')
    expect(h.api.tasks.get(task.id)?.vault_ref).toBeNull()

    expect((await h.sync()).status).toBe('applied')
    expect(await h.read('Tasks/Meowlendar.md')).toBe(text)
    expect(h.api.tasks.size).toBe(1)
    expect(h.api.only().vault_ref).toBe(`work:${idIn(text)}`)
    expect((await h.plan()).empty).toBe(true)
  })

  it('a clear-ref that failed is tried again', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, '')
    h.api.armFailure(1)
    expect((await h.sync()).status).toBe('partial')
    expect(h.api.only().vault_ref).toBe(`work:${h.id}`)
    await h.sync()
    expect(h.api.only().vault_ref).toBeNull()
    expect((await h.plan()).empty).toBe(true)
  })

  it('a run that died before saving state, after creating the task, adopts it', async () => {
    const h = await synced('- [ ] a')
    await rm(h.path('.meowlendar/sync-state.json'))
    const plan = await h.plan()
    expect(plan.appChanges).toEqual([])
    await h.apply(plan.planId)
    expect(h.api.tasks.size).toBe(1)
    expect((await h.plan()).empty).toBe(true)
  })

  it('a run that died before saving state, after importing, does not double up', async () => {
    const h = await setup()
    h.api.seed({ title: 'From app' })
    await h.sync()
    const text = await h.read('Tasks/Meowlendar.md')
    await rm(h.path('.meowlendar/sync-state.json'))
    await h.sync()
    expect(await h.read('Tasks/Meowlendar.md')).toBe(text)
    expect(h.api.tasks.size).toBe(1)
    expect((await h.plan()).empty).toBe(true)
  })

  it('a lost state file with a removed line brings the task back as a line', async () => {
    const h = await synced('- [ ] a')
    await rm(h.path('.meowlendar/sync-state.json'))
    await h.write(FILE, '')
    await h.sync()
    expect(await h.read('Tasks/Meowlendar.md')).toContain(`🆔 ${h.id}`)
    expect(h.api.only().vault_ref).toBe(`work:${h.id}`)
    expect((await h.plan()).empty).toBe(true)
  })

  it('a damaged state file stops the sync', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    await h.write('.meowlendar/sync-state.json', '{ not json')
    await expect(h.plan()).rejects.toThrow(/backups/)
  })

  it('a state file from another connection name stops the sync', async () => {
    const h = await synced('- [ ] a')
    const renamed = await setup()
    await renamed.write('.meowlendar/sync-state.json', await h.read('.meowlendar/sync-state.json'))
    renamed.connection.name = 'home'
    await expect(renamed.plan()).rejects.toThrow(/last synced under the name "work"/)
  })
})
