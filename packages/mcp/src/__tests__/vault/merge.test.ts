import { describe, expect, it } from 'vitest'
import { mergeFields } from '../../vault/merge.js'
import type { SyncFields } from '../../vault/types.js'

const base: SyncFields = { title: 'a', status: 'backlog', due: '2026-01-01', importance: 'normal', completed: null }
const done: SyncFields = { ...base, status: 'done', completed: '2026-01-05' }

describe('mergeFields, one field at a time', () => {
  const cases: [keyof SyncFields, SyncFields[keyof SyncFields], SyncFields[keyof SyncFields]][] = [
    ['title', 'vault title', 'app title'],
    ['due', '2026-02-02', '2026-03-03'],
    ['importance', 'high', 'low'],
    ['status', 'in_progress', 'done'],
  ]

  it.each(cases)('%s: unchanged on both sides does nothing', (field) => {
    const r = mergeFields(base, base, base)
    expect(r.toApp[field]).toBeUndefined()
    expect(r.toVault[field]).toBeUndefined()
    expect(r.conflicts).toEqual([])
  })

  it.each(cases)('%s: changed in the vault flows to the app', (field, v) => {
    const vault = { ...base, [field]: v }
    const r = mergeFields(vault, base, base)
    expect(r.toApp[field]).toBe(v)
    expect(r.toVault).toEqual({})
    expect(r.conflicts).toEqual([])
    expect(r.merged[field]).toBe(v)
  })

  it.each(cases)('%s: changed in the app flows to the vault', (field, _v, a) => {
    const app = { ...base, [field]: a }
    const r = mergeFields(base, app, base)
    expect(r.toVault[field]).toBe(a)
    expect(r.toApp).toEqual({})
    expect(r.conflicts).toEqual([])
    expect(r.merged[field]).toBe(a)
  })

  it.each(cases)('%s: both changed the same way needs no write', (field, v) => {
    const same = { ...base, [field]: v }
    const r = mergeFields(same, same, base)
    expect(r.toApp).toEqual({})
    expect(r.toVault).toEqual({})
    expect(r.conflicts).toEqual([])
    expect(r.merged[field]).toBe(v)
  })

  it.each(cases)('%s: both changed differently, the vault wins and the app value is listed', (field, v, a) => {
    const r = mergeFields({ ...base, [field]: v }, { ...base, [field]: a }, base)
    expect(r.toApp[field]).toBe(v)
    expect(r.toVault[field]).toBeUndefined()
    expect(r.merged[field]).toBe(v)
    expect(r.conflicts).toContainEqual({ field, vault: v, app: a, base: base[field] })
  })

  it('different fields changed on different sides both flow', () => {
    const r = mergeFields({ ...base, title: 'new' }, { ...base, due: '2026-09-09' }, base)
    expect(r.toApp).toEqual({ title: 'new' })
    expect(r.toVault).toEqual({ due: '2026-09-09' })
    expect(r.merged).toMatchObject({ title: 'new', due: '2026-09-09' })
    expect(r.conflicts).toEqual([])
  })

  it('with no snapshot, a difference goes to the vault and is listed', () => {
    const r = mergeFields({ ...base, title: 'v' }, { ...base, title: 'a' }, null)
    expect(r.toApp).toEqual({ title: 'v' })
    expect(r.conflicts).toEqual([{ field: 'title', vault: 'v', app: 'a', base: null }])
  })
})

describe('mergeFields, the completion date', () => {
  it('done in the vault sends the date with the status', () => {
    const r = mergeFields(done, base, base)
    expect(r.toApp).toMatchObject({ status: 'done', completed: '2026-01-05' })
  })

  it('done in the app writes both to the line', () => {
    const r = mergeFields(base, done, base)
    expect(r.toVault).toMatchObject({ status: 'done', completed: '2026-01-05' })
  })

  it('reopened in the app removes the date from the line', () => {
    const r = mergeFields(done, base, done)
    expect(r.toVault).toMatchObject({ status: 'backlog', completed: null })
    expect(r.merged.completed).toBeNull()
  })

  it('reopened in the vault sends only the status, the app clears the date itself', () => {
    const r = mergeFields(base, done, done)
    expect(r.toApp).toEqual({ status: 'backlog' })
    expect(r.merged.completed).toBeNull()
  })

  it('a date edited in the vault flows to the app', () => {
    const r = mergeFields({ ...done, completed: '2026-02-02' }, done, done)
    expect(r.toApp).toEqual({ completed: '2026-02-02' })
  })

  it('a date edited in the app flows to the line', () => {
    const r = mergeFields(done, { ...done, completed: '2026-02-02' }, done)
    expect(r.toVault).toEqual({ completed: '2026-02-02' })
  })

  it('dates that disagree on both sides follow the conflict rule', () => {
    const r = mergeFields({ ...done, completed: '2026-02-02' }, { ...done, completed: '2026-03-03' }, done)
    expect(r.toApp).toEqual({ completed: '2026-02-02' })
    expect(r.conflicts).toEqual([{ field: 'completed', vault: '2026-02-02', app: '2026-03-03', base: '2026-01-05' }])
  })

  it('a line that drops its ✅ does not blank the app date', () => {
    const r = mergeFields({ ...done, completed: null }, done, done)
    expect(r.toApp).toEqual({})
    expect(r.toVault).toEqual({})
    expect(r.merged.completed).toBeNull()
  })

  it('a [x] line with no ✅ takes a date set in the app', () => {
    const noDate = { ...done, completed: null }
    const r = mergeFields(noDate, done, noDate)
    expect(r.toVault).toEqual({ completed: '2026-01-05' })
  })

  it('with no snapshot, a [x] line with no ✅ stays as written', () => {
    const r = mergeFields({ ...done, completed: null }, done, null)
    expect(r.toVault).toEqual({})
    expect(r.toApp).toEqual({})
    expect(r.conflicts).toEqual([])
  })

  it('a status conflict the vault wins does not also report the date', () => {
    const r = mergeFields(done, { ...base, status: 'in_progress' }, base)
    expect(r.conflicts.map((c) => c.field)).toEqual(['status'])
    expect(r.toApp).toMatchObject({ status: 'done', completed: '2026-01-05' })
  })

  it('an app reopen beats a vault date edit, since the date only exists on a done task', () => {
    const r = mergeFields({ ...done, completed: '2026-02-02' }, base, done)
    expect(r.merged).toMatchObject({ status: 'backlog', completed: null })
    expect(r.toVault).toMatchObject({ status: 'backlog', completed: null })
    expect(r.conflicts).toEqual([])
  })
})
