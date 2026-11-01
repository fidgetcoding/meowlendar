import { stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { dateToCompletedAt, localDate } from '../../vault/mapping.js'
import { FILE, idIn, setup, synced } from './helpers.js'

describe('a vault line becomes a task', () => {
  it('creates the task and gives the line an id', async () => {
    const h = await setup({ [FILE]: '# Notes\n\n- [ ] Buy milk ⏫ 📅 2026-04-15 #home\ntext\n' })
    const result = await h.sync()
    expect(result.status).toBe('applied')
    const text = await h.read(FILE)
    const id = idIn(text)
    expect(id).toMatch(/^mw-[0-9a-f]{8}$/)
    expect(text).toBe(`# Notes\n\n- [ ] Buy milk ⏫ 📅 2026-04-15 #home 🆔 ${id}\ntext\n`)
    expect(h.api.only()).toMatchObject({
      title: 'Buy milk',
      status: 'backlog',
      importance: 'high',
      due_date: '2026-04-15',
      vault_ref: `work:${id}`,
    })
  })

  it('keeps an existing id byte for byte, whatever its format', async () => {
    for (const id of ['abc123', 'm-1a2b3c4d', '123e4567-e89b-12d3-a456-426614174000']) {
      const line = `- [ ] Task 🆔 ${id}`
      const h = await setup({ [FILE]: `${line}\n` })
      await h.sync()
      expect(await h.read(FILE)).toBe(`${line}\n`)
      expect(h.api.only().vault_ref).toBe(`work:${id}`)
    }
  })

  it('never touches non-task lines or fenced examples', async () => {
    const content = '---\ntags: [a]\n---\nprose\n```\n- [ ] example\n```\n* [ ] real 🆔 x1\n> quote\n'
    const h = await setup({ [FILE]: content })
    await h.sync()
    expect(await h.read(FILE)).toBe(content)
    expect(h.api.only().title).toBe('real')
  })

  it('keeps CRLF endings and a missing final newline when adding an id', async () => {
    const h = await setup({ [FILE]: 'x\r\n- [ ] a\r\n- [ ] b' })
    await h.sync()
    const text = await h.read(FILE)
    expect(text).toMatch(/^x\r\n- \[ \] a 🆔 mw-[0-9a-f]{8}\r\n- \[ \] b 🆔 mw-[0-9a-f]{8}$/)
  })

  it('gives identical lines different ids', async () => {
    const h = await setup({ [FILE]: '- [ ] same\n- [ ] same\n' })
    await h.sync()
    expect(h.api.tasks.size).toBe(2)
    expect((await h.plan()).empty).toBe(true)
  })

  it('leaves [-] lines without a link out of the sync', async () => {
    const content = '- [-] dropped\n- [-] dropped too 🆔 z9\n'
    const h = await setup({ [FILE]: content })
    expect((await h.plan()).empty).toBe(true)
    expect(await h.read(FILE)).toBe(content)
    expect(h.api.tasks.size).toBe(0)
  })

  it('walks subfolders and ignores everything that is not markdown', async () => {
    const h = await setup({
      'Tasks/deep/er/b.md': '- [ ] deep 🆔 d1\n',
      'Tasks/c.txt': '- [ ] text file\n',
      'Tasks/.hidden/d.md': '- [ ] hidden dir\n',
      'Other/e.md': '- [ ] outside the folder\n',
    })
    await h.sync()
    expect(h.api.only().title).toBe('deep')
  })
})

describe('each mapping, vault to app', () => {
  it.each([
    ['[x]', '- [x] a', { status: 'done' }],
    ['[X]', '- [X] a', { status: 'done' }],
    ['[/]', '- [/] a', { status: 'in_progress' }],
    ['[ ]', '- [ ] a', { status: 'backlog' }],
    ['📅', '- [ ] a 📅 2026-04-15', { due_date: '2026-04-15' }],
    ['🔺', '- [ ] a 🔺', { importance: 'highest' }],
    ['⏫', '- [ ] a ⏫', { importance: 'high' }],
    ['🔼', '- [ ] a 🔼', { importance: 'normal' }],
    ['🔽', '- [ ] a 🔽', { importance: 'low' }],
    ['⏬', '- [ ] a ⏬', { importance: 'lowest' }],
    ['no emoji', '- [ ] a', { importance: 'normal' }],
    ['tags', '- [ ] a #t #u', { title: 'a' }],
  ])('%s creates the matching task', async (_label, line, expected) => {
    const h = await synced(line)
    expect(h.api.only()).toMatchObject(expected)
  })

  it('sends the ✅ date as completed_at', async () => {
    const h = await synced('- [x] a ✅ 2026-04-16')
    expect(h.api.only().completed_at).toBe(dateToCompletedAt('2026-04-16'))
    expect(localDate(new Date(h.api.only().completed_at as string))).toBe('2026-04-16')
    expect((await h.plan()).empty).toBe(true)
  })

  it('keeps scheduled, start, recurrence, and tags out of the app', async () => {
    const h = await synced('- [ ] a ⏳ 2026-04-14 🛫 2026-04-13 🔁 every week #t')
    const task = h.api.only()
    expect(task.title).toBe('a')
    expect(JSON.stringify(task)).not.toMatch(/04-14|04-13|every week|#t/)
  })

  it('flows a title edit, leaving the line as the person wrote it', async () => {
    const h = await synced('- [ ] a')
    const edited = (await h.read(FILE)).replace('] a', '] b')
    await h.write(FILE, edited)
    expect((await h.sync()).status).toBe('applied')
    expect(h.api.only().title).toBe('b')
    expect(await h.read(FILE)).toBe(edited)
    expect((await h.plan()).empty).toBe(true)
  })

  it('flows [x] with no ✅, and does not add one', async () => {
    const h = await synced('- [ ] a')
    const edited = (await h.read(FILE)).replace('[ ]', '[x]')
    await h.write(FILE, edited)
    await h.sync()
    expect(h.api.only().status).toBe('done')
    expect(h.api.only().completed_at).not.toBeNull()
    expect(await h.read(FILE)).toBe(edited)
    expect((await h.plan()).empty).toBe(true)
  })

  it('flows a reopen back to the app, which clears its date', async () => {
    const h = await synced('- [x] a ✅ 2026-01-01')
    await h.write(FILE, (await h.read(FILE)).replace('[x]', '[/]').replace(' ✅ 2026-01-01', ''))
    await h.sync()
    expect(h.api.only()).toMatchObject({ status: 'in_progress', completed_at: null })
    expect((await h.plan()).empty).toBe(true)
  })

  it('flows due, priority, and completion edits', async () => {
    const h = await synced('- [ ] a 📅 2026-01-01 ⏫')
    await h.write(FILE, (await h.read(FILE)).replace('2026-01-01', '2026-02-02').replace('⏫', '🔽').replace('[ ]', '[x]').replace('🆔', '✅ 2026-03-03 🆔'))
    await h.sync()
    expect(h.api.only()).toMatchObject({ due_date: '2026-02-02', importance: 'low', status: 'done', completed_at: dateToCompletedAt('2026-03-03') })
  })

  it('clears a removed due date', async () => {
    const h = await synced('- [ ] a 📅 2026-01-01')
    await h.write(FILE, (await h.read(FILE)).replace(' 📅 2026-01-01', ''))
    await h.sync()
    expect(h.api.only().due_date).toBeNull()
  })
})

describe('each mapping, app to vault', () => {
  async function appEdit(start: string, patch: Parameters<typeof Object.assign>[1]) {
    const h = await synced(start)
    const task = h.api.tasks.get(h.taskId)
    h.api.tasks.set(h.taskId, { ...task, ...patch } as typeof task & object)
    const before = await h.read(FILE)
    const result = await h.sync()
    expect(result.status).toBe('applied')
    expect((await h.plan()).empty).toBe(true)
    return { before, after: await h.read(FILE), id: h.id }
  }

  it('title, leaving everything else on the line', async () => {
    const { after, id } = await appEdit('- [ ] old #t ⏳ 2026-01-01', { title: 'new' })
    expect(after).toBe(`- [ ] new #t ⏳ 2026-01-01 🆔 ${id}\n`)
  })

  it('done, with the completion date', async () => {
    const { after, id } = await appEdit('- [ ] a', { status: 'done', completed_at: dateToCompletedAt('2026-05-05') })
    expect(after).toBe(`- [x] a ✅ 2026-05-05 🆔 ${id}\n`)
  })

  it('in progress', async () => {
    const { after, id } = await appEdit('- [ ] a', { status: 'in_progress' })
    expect(after).toBe(`- [/] a 🆔 ${id}\n`)
  })

  it('back to backlog, dropping the done date', async () => {
    const { after, id } = await appEdit('- [x] a ✅ 2026-05-05', { status: 'backlog', completed_at: null })
    expect(after).toBe(`- [ ] a 🆔 ${id}\n`)
  })

  it('the check column reads as [/] and never churns', async () => {
    const { after, id } = await appEdit('- [ ] a', { status: 'check' })
    expect(after).toBe(`- [/] a 🆔 ${id}\n`)
  })

  it('moving between in_progress and check is no change to the line', async () => {
    const h = await synced('- [/] a')
    const before = await h.read(FILE)
    h.api.tasks.set(h.taskId, { ...h.api.only(), status: 'check' })
    expect((await h.plan()).empty).toBe(true)
    await h.write(FILE, before.replace('[/]', '[ ]'))
    await h.sync()
    expect(h.api.only().status).toBe('backlog')
  })

  it('due date added, changed, and removed', async () => {
    expect((await appEdit('- [ ] a', { due_date: '2026-07-07' })).after).toContain('a 📅 2026-07-07 🆔')
    expect((await appEdit('- [ ] a 📅 2026-01-01', { due_date: '2026-07-07' })).after).toContain('a 📅 2026-07-07 🆔')
    expect((await appEdit('- [ ] a 📅 2026-01-01', { due_date: null })).after).toMatch(/\] a 🆔/)
  })

  it.each([
    ['highest', '🔺'],
    ['high', '⏫'],
    ['low', '🔽'],
    ['lowest', '⏬'],
  ])('importance %s', async (importance, symbol) => {
    const { after } = await appEdit('- [ ] a', { importance })
    expect(after).toContain(`a ${symbol} 🆔`)
  })

  it('importance normal removes the emoji', async () => {
    const { after } = await appEdit('- [ ] a ⏫', { importance: 'normal' })
    expect(after).toMatch(/\] a 🆔/)
  })

  it('leaves 🔼 alone when nothing changed, and [X] too', async () => {
    const line = '- [X] a 🔼 ✅ 2026-01-01 🆔 keep'
    const h = await setup({ [FILE]: `${line}\n` })
    await h.sync()
    expect(await h.read(FILE)).toBe(`${line}\n`)
    expect(h.api.only().importance).toBe('normal')
    expect((await h.plan()).empty).toBe(true)
  })

  it('a title with a newline or a smuggled field can not add a line or a token', async () => {
    const { after, id } = await appEdit('- [ ] a', { title: 'pwned\n- [ ] extra 🆔 evil' })
    expect(after).toBe(`- [ ] pwned - [ ] extra 🆔 ${id}\n`)
    expect(after.split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('a title made only of tokens keeps the line as it was and does not loop', async () => {
    const h = await synced('- [ ] a')
    const before = await h.read(FILE)
    h.api.tasks.set(h.taskId, { ...h.api.only(), title: '#only-a-tag' })
    const plan = await h.plan()
    expect(plan.empty).toBe(true)
    await h.apply(plan.planId)
    expect(await h.read(FILE)).toBe(before)
    expect(h.api.only().title).toBe('#only-a-tag')
  })
})

describe('the stated conflict rule', () => {
  it('the vault wins, the app loses its value, and the plan lists it', async () => {
    const h = await synced('- [ ] a 📅 2026-01-01')
    await h.write(FILE, (await h.read(FILE)).replace('2026-01-01', '2026-02-02'))
    h.api.tasks.set(h.taskId, { ...h.api.only(), due_date: '2026-03-03' })
    const plan = await h.plan()
    expect(plan.conflicts).toEqual([
      { id: h.id, file: FILE, field: 'due', vaultValue: '2026-02-02', appValue: '2026-03-03', baseValue: '2026-01-01' },
    ])
    const result = await h.apply(plan.planId)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflictRule).toContain('the vault wins')
    expect(plan.conflictRule).toContain('the vault wins')
    expect(h.api.only().due_date).toBe('2026-02-02')
    expect(await h.read(FILE)).toContain('2026-02-02')
    expect((await h.plan()).empty).toBe(true)
  })

  it('different fields on each side both land and nothing conflicts', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, (await h.read(FILE)).replace('] a', '] renamed'))
    h.api.tasks.set(h.taskId, { ...h.api.only(), due_date: '2026-03-03' })
    const plan = await h.plan()
    expect(plan.conflicts).toEqual([])
    await h.apply(plan.planId)
    expect(h.api.only()).toMatchObject({ title: 'renamed', due_date: '2026-03-03' })
    expect(await h.read(FILE)).toBe(`- [ ] renamed 📅 2026-03-03 🆔 ${h.id}\n`)
    expect((await h.plan()).empty).toBe(true)
  })

  it('both sides making the same edit is quiet', async () => {
    const h = await synced('- [ ] a')
    await h.write(FILE, (await h.read(FILE)).replace('] a', '] same'))
    h.api.tasks.set(h.taskId, { ...h.api.only(), title: 'same' })
    const plan = await h.plan()
    expect(plan.conflicts).toEqual([])
    expect(plan.vaultChanges).toEqual([])
    expect(plan.appChanges).toEqual([])
    await h.apply(plan.planId)
    expect((await h.plan()).empty).toBe(true)
  })
})

describe('a new task in the app', () => {
  it('lands in Meowlendar.md, created if needed, with its link set', async () => {
    const h = await setup()
    h.api.seed({ title: 'From app', importance: 'high', due_date: '2026-08-08' })
    h.api.seed({ title: 'Finished', status: 'done', completed_at: dateToCompletedAt('2026-08-01') })
    h.api.seed({ title: 'Checking', status: 'check' })
    await h.sync()
    const text = await h.read('Tasks/Meowlendar.md')
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toMatch(/^- \[ \] From app ⏫ 📅 2026-08-08 🆔 mw-[0-9a-f]{8}$/)
    expect(lines[1]).toMatch(/^- \[x\] Finished ✅ 2026-08-01 🆔 mw-/)
    expect(lines[2]).toMatch(/^- \[\/\] Checking 🆔 mw-/)
    for (const task of h.api.tasks.values()) expect(task.vault_ref).toMatch(/^work:mw-/)
    expect((await h.plan()).empty).toBe(true)
  })

  it('appends to an existing file, keeping its bytes and line endings', async () => {
    const h = await setup({ 'Tasks/Meowlendar.md': '# Mine\r\nno newline at end' })
    h.api.seed({ title: 'New' })
    await h.sync()
    const text = await h.read('Tasks/Meowlendar.md')
    expect(text).toMatch(/^# Mine\r\nno newline at end\r\n- \[ \] New 🆔 mw-[0-9a-f]{8}\r\n$/)
  })

  it('goes at the vault root when the folder is the whole vault', async () => {
    const h = await setup({}, { folder: '.' })
    h.api.seed({ title: 'New' })
    await h.sync()
    expect(await h.read('Meowlendar.md')).toContain('New')
  })

  it('stays out of the vault with import turned off', async () => {
    const h = await setup({ [FILE]: '- [ ] line 🆔 x1\n' }, { importAppTasks: false })
    const appTask = h.api.seed({ title: 'From app' })
    await h.sync()
    await expect(stat(h.path('Tasks/Meowlendar.md'))).rejects.toThrow()
    expect(h.api.tasks.get(appTask.id)?.vault_ref).toBeNull()
    expect(h.api.tasks.size).toBe(2)
    expect((await h.plan()).empty).toBe(true)
  })

  it('leaves tasks linked to another vault alone', async () => {
    const h = await setup()
    h.api.seed({ title: 'Theirs', vault_ref: 'other:abc' })
    expect((await h.plan()).empty).toBe(true)
  })

  it('reports a title that can not be a line and does not import it', async () => {
    const h = await setup()
    h.api.seed({ title: '#just-a-tag' })
    const plan = await h.plan()
    expect(plan.empty).toBe(true)
    expect(plan.skipped[0]?.reason).toContain("can't be written as line text")
  })

  it('will not import into a file that ends in an open code fence', async () => {
    const h = await setup({ 'Tasks/Meowlendar.md': '```\nopen\n' })
    const task = h.api.seed({ title: 'New' })
    const plan = await h.plan()
    expect(plan.vaultChanges).toEqual([])
    expect(plan.skipped[0]?.reason).toContain('code fence')
    await h.apply(plan.planId)
    expect(h.api.tasks.get(task.id)?.vault_ref).toBeNull()
  })
})
