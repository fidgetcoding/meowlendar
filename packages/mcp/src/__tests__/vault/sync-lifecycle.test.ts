import { readdir, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PlanMismatchError } from '../../vault/types.js'
import { FILE, NOW, TODAY, setup, synced } from './helpers.js'

describe('deletes are never destructive', () => {
  it('a removed line keeps the task, clears its link, and reports it', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, '# empty now\n')
    const plan = await h.plan()
    expect(plan.removedFromVault).toEqual([{ id: h.id, taskId: h.taskId, title: 'a', reason: 'line-removed' }])
    await h.apply(plan.planId)
    expect(h.api.tasks.get(h.taskId)).toMatchObject({ title: 'a', vault_ref: null })
    expect(await h.read(FILE)).toBe('# empty now\n')
  })

  it('does not import a task back after its line was removed', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, '')
    await h.sync()
    const plan = await h.plan()
    expect(plan.empty).toBe(true)
    await expect(stat(h.path('Tasks/Meowlendar.md'))).rejects.toThrow()
  })

  it('relinks when a removed line comes back with its id', async () => {
    const h = await synced('- [ ] a')
    const text = await h.read(FILE)
    await h.write(FILE, '')
    await h.sync()
    await h.write(FILE, text)
    await h.sync()
    expect(h.api.tasks.size).toBe(1)
    expect(h.api.only().vault_ref).toBe(`work:${h.id}`)
    expect((await h.plan()).empty).toBe(true)
  })

  it('a task deleted in the app marks the line [-] with ❌ and reports it', async () => {
    const h = await synced('    * [ ] a ⏫ #t')
    h.api.tasks.delete(h.taskId)
    const plan = await h.plan()
    expect(plan.deletedInApp).toEqual([{ id: h.id, taskId: h.taskId, file: FILE, line: 1 }])
    await h.apply(plan.planId)
    expect(await h.read(FILE)).toBe(`    * [-] a ⏫ #t ❌ ${TODAY} 🆔 ${h.id}\n`)
    expect(h.api.tasks.size).toBe(0)
  })

  it('does not recreate a task from its cancelled line', async () => {
    const h = await synced('- [ ] a')
    h.api.tasks.delete(h.taskId)
    await h.sync()
    const plan = await h.plan()
    expect(plan.empty).toBe(true)
    await h.apply(plan.planId)
    expect(h.api.tasks.size).toBe(0)
  })

  it('a line cancelled in the vault keeps the task and clears its link', async () => {
    const h = await synced('- [ ] a')
    const edited = (await h.read(FILE)).replace('[ ]', '[-]')
    await h.write(FILE, edited)
    const plan = await h.plan()
    expect(plan.removedFromVault[0]?.reason).toBe('line-cancelled')
    await h.apply(plan.planId)
    expect(h.api.only().vault_ref).toBeNull()
    expect(await h.read(FILE)).toBe(edited)
    expect((await h.plan()).empty).toBe(true)
  })

  it('a line gone and its task gone together just drops the record', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, '')
    h.api.tasks.delete(h.taskId)
    const plan = await h.plan()
    expect(plan.stateChanges).toBe(1)
    await h.apply(plan.planId)
    expect((await h.state()).entries).toEqual({})
    expect((await h.plan()).empty).toBe(true)
  })

  it('stops instead of cancelling every line when all tracked tasks vanish', async () => {
    const lines = ['a', 'b', 'c', 'd', 'e'].map((t) => `- [ ] ${t}\n`).join('')
    const h = await setup({ [FILE]: lines })
    await h.sync()
    h.api.tasks.clear()
    await expect(h.plan()).rejects.toThrow(/another account/)
  })
})

describe('moves and awkward lines', () => {
  it('follows a line to another file with no app change', async () => {
    const h = await synced('- [ ] a')
    const text = await h.read(FILE)
    await h.write(FILE, '')
    await h.write('Tasks/b.md', text)
    const plan = await h.plan()
    expect(plan.appChanges).toEqual([])
    expect(plan.stateChanges).toBe(1)
    await h.apply(plan.planId)
    const state = (await h.state()) as { entries: Record<string, { file: string }> }
    expect(state.entries[h.id]?.file).toBe('Tasks/b.md')
    expect((await h.plan()).empty).toBe(true)
  })

  it('freezes an id on two lines, reporting both and changing neither', async () => {
    const h = await synced('- [ ] a')
    const text = await h.read(FILE)
    const doubled = text + text
    await h.write(FILE, doubled)
    const plan = await h.plan()
    expect(plan.skipped).toHaveLength(2)
    expect(plan.skipped[0]?.reason).toContain('more than one line')
    expect(plan.empty).toBe(true)
    await h.apply(plan.planId)
    expect(await h.read(FILE)).toBe(doubled)
    expect(h.api.only().vault_ref).toBe(`work:${h.id}`)
  })

  it.each([
    ['an id the app can not store', '- [ ] a 🆔 café'],
    ['a status with no match', '- [?] a 🆔 x1'],
    ['no task text', '- [ ] #only-tag 🆔 x1'],
    ['an impossible due date', '- [ ] a 📅 2026-02-31 🆔 x1'],
    ['an impossible done date', '- [x] a ✅ 2026-13-01 🆔 x1'],
    ['text too long for the app', `- [ ] ${'y'.repeat(501)} 🆔 x1`],
  ])('reports and leaves alone a line with %s', async (_label, line) => {
    const h = await setup({ [FILE]: `${line}\n` })
    const plan = await h.plan()
    expect(plan.skipped).toHaveLength(1)
    expect(plan.empty).toBe(true)
    await h.apply(plan.planId)
    expect(await h.read(FILE)).toBe(`${line}\n`)
    expect(h.api.tasks.size).toBe(0)
  })

  it('does not treat a tracked line that became unsyncable as removed', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, (await h.read(FILE)).replace('[ ]', '[?]'))
    const plan = await h.plan()
    expect(plan.removedFromVault).toEqual([])
    expect(h.api.only().vault_ref).toBe(`work:${h.id}`)
  })

  it('refuses to adopt a line whose task now points elsewhere', async () => {
    const h = await synced('- [ ] a')
    h.api.tasks.set(h.taskId, { ...h.api.only(), vault_ref: 'other:zzz' })
    const plan = await h.plan()
    expect(plan.skipped[0]?.reason).toContain('other:zzz')
    expect(plan.deletedInApp).toEqual([])
    expect(plan.empty).toBe(true)
  })

  it('relinks when the app lost the ref but the task is still there', async () => {
    const h = await synced('- [ ] a')
    h.api.tasks.set(h.taskId, { ...h.api.only(), vault_ref: null })
    const plan = await h.plan()
    expect(plan.appChanges[0]?.action).toBe('link')
    await h.apply(plan.planId)
    expect(h.api.only().vault_ref).toBe(`work:${h.id}`)
    expect((await h.plan()).empty).toBe(true)
  })

  it('reads a reformatted timestamp as the same moment', async () => {
    const h = await synced('- [x] a')
    const before = await h.read(FILE)
    const raw = h.api.only().completed_at as string
    h.api.tasks.set(h.taskId, { ...h.api.only(), completed_at: raw.replace('Z', '+00:00') })
    expect((await h.plan()).empty).toBe(true)
    expect(await h.read(FILE)).toBe(before)
  })
})

describe('plan first', () => {
  it('plan writes nothing, not even the state folder', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    h.api.seed({ title: 'From app' })
    const writes = h.api.writes
    const plan = await h.plan()
    expect(plan.empty).toBe(false)
    expect(plan.vaultChanges.length).toBeGreaterThan(0)
    expect(h.api.writes).toBe(writes)
    expect(await h.read(FILE)).toBe('- [ ] a\n')
    await expect(stat(h.path('.meowlendar'))).rejects.toThrow()
    await expect(stat(h.path('Tasks/Meowlendar.md'))).rejects.toThrow()
  })

  it('the same inputs give the same plan ID', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n- [ ] a\n' })
    h.api.seed({ title: 'From app' })
    expect((await h.plan()).planId).toBe((await h.plan()).planId)
  })

  it.each([
    ['a line changed', async (h: Awaited<ReturnType<typeof setup>>) => h.write(FILE, '- [ ] a\n- [ ] more\n')],
    ['a file with no tasks changed', async (h: Awaited<ReturnType<typeof setup>>) => h.write('Tasks/note.md', 'other words\n')],
    ['an app task changed', async (h: Awaited<ReturnType<typeof setup>>) => void h.api.seed({ title: 'Another' })],
  ])('apply refuses when %s, and writes nothing', async (_label, change) => {
    const h = await setup({ [FILE]: '- [ ] a\n', 'Tasks/note.md': 'words\n' })
    const { planId } = await h.plan()
    await change(h)
    const before = await h.read(FILE)
    await expect(h.apply(planId)).rejects.toThrow(PlanMismatchError)
    expect(await h.read(FILE)).toBe(before)
    expect(h.api.writes).toBe(0)
    await expect(stat(h.path('.meowlendar'))).rejects.toThrow()
  })

  it('apply refuses when a tracked task changed in the app', async () => {
    const h = await synced('- [ ] a')
    const { planId } = await h.plan()
    h.api.tasks.set(h.taskId, { ...h.api.only(), title: 'changed' })
    await expect(h.apply(planId)).rejects.toThrow(PlanMismatchError)
  })

  it('apply refuses an ID that was never planned', async () => {
    const h = await setup({ [FILE]: '- [ ] a\n' })
    await expect(h.apply('0'.repeat(32))).rejects.toThrow(PlanMismatchError)
  })

  it('a plan with import off does not apply with import on', async () => {
    const off = await setup({ [FILE]: '- [ ] a\n' }, { importAppTasks: false })
    off.api.seed({ title: 'From app' })
    const { planId } = await off.plan()
    off.connection.importAppTasks = true
    await expect(off.apply(planId)).rejects.toThrow(PlanMismatchError)
  })
})

describe('idempotence', () => {
  it('a re-run after a mixed apply is an empty plan that writes nothing', async () => {
    const h = await setup({
      [FILE]: '- [ ] new\n- [x] done ✅ 2026-01-01\n- [/] going ⏫ 📅 2026-03-03 #t\n* [ ] mine 🆔 m-1a2b3c4d\n',
      'Tasks/sub/b.md': '- [X] other\n',
    })
    h.api.seed({ title: 'From app' })
    h.api.seed({ title: 'Done in app', status: 'done', completed_at: '2026-02-02T23:30:00.000Z' })
    expect((await h.sync()).status).toBe('applied')

    const before = { a: await h.read(FILE), b: await h.read('Tasks/sub/b.md'), m: await h.read('Tasks/Meowlendar.md') }
    const writes = h.api.writes
    const again = await h.plan()
    expect(again).toMatchObject({ empty: true, vaultChanges: [], appChanges: [], conflicts: [], stateChanges: 0 })

    const backups = await readdir(h.path('.meowlendar/backups'))
    const result = await h.apply(again.planId)
    expect(result.status).toBe('nothing-to-do')
    expect(await readdir(h.path('.meowlendar/backups'))).toEqual(backups)
    expect(h.api.writes).toBe(writes)
    expect(await h.read(FILE)).toBe(before.a)
    expect(await h.read('Tasks/sub/b.md')).toBe(before.b)
    expect(await h.read('Tasks/Meowlendar.md')).toBe(before.m)
  })

  it('stays empty under a clock that has moved on', async () => {
    let now = NOW
    const h = await setup({ [FILE]: '- [ ] a\n' }, { now: () => now })
    await h.sync()
    now = new Date(2030, 0, 1)
    expect((await h.plan()).empty).toBe(true)
  })
})
