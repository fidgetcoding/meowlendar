// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
// The seed is plain Node so `pnpm setup:local` runs it without a build step.
import { buildDemoWeek, isLocalSupabaseUrl, seedDemoAccount, DEMO_EMAIL, DEMO_PASSWORD } from '../../../scripts/demo-account.mjs'

type Row = Record<string, unknown>

// Thursday 5 November 2026, 10:40 in this machine's zone.
const TODAY = new Date(2026, 10, 5, 10, 40)
const week = buildDemoWeek(TODAY)
const local = (iso: unknown) => new Date(iso as string)
const dayOf = (iso: unknown) => local(iso).getDate()
const hm = (iso: unknown) => `${local(iso).getHours()}:${String(local(iso).getMinutes()).padStart(2, '0')}`

describe('the demo week', () => {
  it('sits in the week around today, in the machine time zone', () => {
    const timed = (week.events as Row[]).filter((e) => !e.is_all_day)
    for (const e of timed) {
      const d = local(e.start_time)
      expect(d >= new Date(2026, 10, 1) && d < new Date(2026, 10, 9)).toBe(true)
    }
    const roadmap = (week.events as Row[]).find((e) => e.title === 'Roadmap sync')!
    expect([dayOf(roadmap.start_time), hm(roadmap.start_time)]).toEqual([5, '10:00'])
    expect(week.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('uses all four calendars and includes an overlap and an all-day event', () => {
    expect((week.calendars as Row[]).map((c) => c.name)).toEqual(['My Calendar', 'Work', 'Personal', 'Gym'])
    const used = new Set([...(week.events as Row[]), ...(week.routines as Row[])].map((e) => e.calendar))
    expect(used).toEqual(new Set(['my', 'work', 'personal', 'gym']))

    const timed = (week.events as Row[]).filter((e) => !e.is_all_day)
    const overlaps = timed.some((a) => timed.some((b) => a !== b && local(a.start_time) < local(b.end_time) && local(b.start_time) < local(a.end_time)))
    expect(overlaps).toBe(true)

    const allDay = (week.events as Row[]).find((e) => e.is_all_day)!
    // Exclusive end, the next day at UTC midnight: never zero length.
    expect(allDay.start_time).toBe('2026-11-06T00:00:00.000Z')
    expect(allDay.end_time).toBe('2026-11-07T00:00:00.000Z')
  })

  it('has a recurring routine', () => {
    expect((week.routines as Row[]).some((r) => /^FREQ=/.test(String(r.recurrence_rule)))).toBe(true)
  })

  it('has tasks at every importance, in every column, with tags and subtasks', () => {
    const tasks = week.tasks as Row[]
    expect(new Set(tasks.map((t) => t.importance))).toEqual(new Set(['highest', 'high', 'normal', 'low', 'lowest']))
    expect(new Set(tasks.map((t) => t.status))).toEqual(new Set(['backlog', 'in_progress', 'check', 'done']))
    expect(tasks.every((t) => Array.isArray(t.tags) && (t.tags as string[]).length > 0)).toBe(true)
    expect(tasks.some((t) => Array.isArray(t.subtasks) && (t.subtasks as unknown[]).length > 0)).toBe(true)
    expect(tasks.filter((t) => t.status === 'done').every((t) => t.completed_at)).toBe(true)
  })

  it('has two tasks scheduled by an agent through the API, today and tomorrow', () => {
    const agent = (week.tasks as Row[]).filter((t) => t.created_via === 'api')
    expect(agent).toHaveLength(2)
    expect(agent.map((t) => dayOf(t.scheduled_start)).sort()).toEqual([5, 6])
  })

  it('has one public booking link', () => {
    expect(week.bookingLink).toMatchObject({ slug: 'intro-call', is_public: true, duration_minutes: 30 })
  })
})

describe('where the demo account may be made', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321'])('this machine: %s', (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(true)
  })

  it.each(['https://abcdefgh.supabase.co', 'https://supabase.example.com', 'http://192.168.1.20:54321', 'http://localhost.evil.com', 'not a url'])(
    'nowhere else: %s',
    (url) => expect(isLocalSupabaseUrl(url)).toBe(false),
  )

  it('refuses a hosted Supabase before touching it', async () => {
    const createClient = vi.fn()
    await expect(seedDemoAccount({ url: 'https://abcdefgh.supabase.co', anonKey: 'a', serviceRoleKey: 's', createClient })).rejects.toThrow(/only for a local Supabase/)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('leaves an existing demo account alone unless asked to reset it', async () => {
    const createUser = vi.fn()
    const admin = { auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: 'u1', email: DEMO_EMAIL }] }, error: null }), createUser, deleteUser: vi.fn() } } }
    const createClient = vi.fn(() => admin)
    expect(await seedDemoAccount({ url: 'http://127.0.0.1:54321', anonKey: 'a', serviceRoleKey: 's', createClient })).toBe('exists')
    expect(createUser).not.toHaveBeenCalled()
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled()
    expect(DEMO_PASSWORD).toBe('meowlendar')
  })
})

/** A stand-in Supabase: records every write the seeder makes and answers with plausible rows. */
function fakeSupabase(existingUser: { id: string; email: string } | null) {
  const writes: { table: string; op: string; rows: Row[] }[] = []
  const deleteUser = vi.fn().mockResolvedValue({ error: null })
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u-demo' } }, error: null })
  const admin = {
    auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: existingUser ? [existingUser] : [] }, error: null }), createUser, deleteUser } },
  }
  const answer = (table: string, op: string, rows: Row[]): unknown => {
    if (table === 'calendars' && op === 'select') return [{ id: 'cal-my' }]
    if (table === 'profiles' && op === 'select') return { settings: { time_format: '12h' } }
    if (op === 'insert' && (table === 'calendars' || table === 'tags' || table === 'tasks')) {
      return rows.map((r, i) => ({ id: `${table}-${i}`, name: r.name, title: r.title }))
    }
    return null
  }
  function from(table: string) {
    let op = 'select'
    let rows: Row[] = []
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      limit: () => b,
      single: () => b,
      insert: (r: Row | Row[]) => { op = 'insert'; rows = Array.isArray(r) ? r : [r]; writes.push({ table, op, rows }); return b },
      update: (r: Row) => { op = 'update'; rows = [r]; writes.push({ table, op, rows }); return b },
      then: (resolve: (v: unknown) => void) => resolve({ data: answer(table, op, rows), error: null }),
    }
    return b
  }
  const db = { from, auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'u-demo' } }, error: null }) } }
  const createClient = vi.fn((_url: string, key: string) => (key === 'service' ? admin : db))
  return { createClient, writes, createUser, deleteUser, db }
}

describe('seeding the demo account', () => {
  const args = { url: 'http://127.0.0.1:54321', anonKey: 'anon', serviceRoleKey: 'service', today: TODAY }

  it('creates the user and writes the whole week as that user', async () => {
    const fake = fakeSupabase(null)
    expect(await seedDemoAccount({ ...args, createClient: fake.createClient })).toBe('created')
    expect(fake.createUser).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true })
    expect(fake.db.auth.signInWithPassword).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

    const inserted = (table: string) => fake.writes.filter((w) => w.table === table && w.op === 'insert').flatMap((w) => w.rows)
    expect(inserted('calendars').map((c) => c.name)).toEqual(['Work', 'Personal', 'Gym'])
    expect(inserted('events')).toHaveLength(week.events.length)
    expect(inserted('routines')).toHaveLength(week.routines.length)
    expect(inserted('booking_links')).toHaveLength(1)
    const tasks = inserted('tasks')
    expect(tasks).toHaveLength(week.tasks.length)
    expect(tasks.filter((t) => t.created_via === 'api')).toHaveLength(2)
    // Only real columns reach the tasks table; tags and subtasks go to their own tables.
    expect(tasks.some((t) => 'tags' in t || 'subtasks' in t)).toBe(false)
    expect(inserted('subtasks').every((s) => String(s.task_id).startsWith('tasks-'))).toBe(true)
    expect(inserted('task_tags').every((l) => String(l.task_id).startsWith('tasks-') && String(l.tag_id).startsWith('tags-'))).toBe(true)
    // Every row belongs to the demo user, and events sit on real calendars.
    for (const table of ['calendars', 'events', 'routines', 'tasks', 'tags', 'booking_links']) {
      expect(inserted(table).every((r) => r.user_id === 'u-demo')).toBe(true)
    }
    expect(inserted('events').every((e) => typeof e.calendar_id === 'string' && !('calendar' in e))).toBe(true)
    // Its time zone is the machine's, kept alongside its other settings.
    const settings = fake.writes.find((w) => w.table === 'profiles' && w.op === 'update')!.rows[0]!.settings
    expect(settings).toEqual({ time_format: '12h', timezone: week.timeZone })
  })

  it('--reset-demo replaces an existing account with a fresh week', async () => {
    const fake = fakeSupabase({ id: 'u-old', email: DEMO_EMAIL })
    expect(await seedDemoAccount({ ...args, reset: true, createClient: fake.createClient })).toBe('reset')
    expect(fake.deleteUser).toHaveBeenCalledWith('u-old')
    expect(fake.createUser).toHaveBeenCalled()
    expect(fake.writes.some((w) => w.table === 'events')).toBe(true)
  })
})
