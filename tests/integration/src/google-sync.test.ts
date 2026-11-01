import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { APP, browserApi, createUser, cron, fakes, publicClient, serviceClient, type TestUser } from './helpers'

// Everything here talks to a local fake Google server (tests/fakes/google.mjs),
// not to Google. It shows the app's half of the conversation works. It does not
// prove the real API behaves the same way.

const WEEK = { start: '2030-01-07T00:00:00.000Z', end: '2030-01-13T23:59:59.000Z' }

interface CalendarRow {
  id: string
  name: string
  is_active: boolean
  is_primary: boolean
  google_calendar_id: string
}

/** Runs the real browser flow: connect, Google's redirect, and the app's callback. */
async function connect(user: TestUser, email: string): Promise<void> {
  await fakes('google/login-as', { email })
  const { data } = await publicClient().auth.signInWithPassword({ email: user.email, password: user.password })
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.split('.')[0]
  let cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`

  const start = await fetch(`${APP}/api/google/connect`, { headers: { Cookie: cookie }, redirect: 'manual' })
  expect(start.status).toBe(307)
  const state = start.headers.getSetCookie().find((c) => c.startsWith('oauth_state='))!.split(';')[0]!
  cookie = `${cookie}; ${state}`

  const atGoogle = await fetch(start.headers.get('location')!, { redirect: 'manual' })
  expect(atGoogle.status).toBe(302)

  const back = await fetch(atGoogle.headers.get('location')!, { headers: { Cookie: cookie }, redirect: 'manual' })
  expect(back.status).toBe(307)
  expect(back.headers.get('location')).toContain('google_connected=true')
}

async function calendars(user: TestUser): Promise<CalendarRow[]> {
  const body = (await (await user.api('/api/calendars')).json()) as { accounts: { calendars: CalendarRow[] }[] }
  return body.accounts.flatMap((a) => a.calendars)
}

async function events(user: TestUser): Promise<{ id: string; title: string; start_time: string; calendar_id: string }[]> {
  const res = await user.api(`/api/events?start=${WEEK.start}&end=${WEEK.end}&include=events`)
  return ((await res.json()) as { items: { id: string; title: string; start_time: string; calendar_id: string }[] }).items
}

function remoteEvent(id: string, summary: string, day = '08', extra: Record<string, unknown> = {}) {
  return {
    id,
    summary,
    start: { dateTime: `2030-01-${day}T10:00:00Z`, timeZone: 'UTC' },
    end: { dateTime: `2030-01-${day}T11:00:00Z`, timeZone: 'UTC' },
    ...extra,
  }
}

async function remoteEvents(email: string, calendarId: string) {
  const { items } = await fakes<{ items: { id: string; summary: string; status: string; start: { dateTime: string } }[] }>(
    'google/list-events',
    { email, calendarId },
  )
  return items
}

let n = 0
const newEmail = () => `person${Date.now().toString(36)}${++n}@gmail.test`

/** Forces a pull, as the Resync button does. */
async function pull(user: TestUser) {
  const accounts = (await (await user.api('/api/calendars')).json()) as { accounts: { id: string }[] }
  for (const account of accounts.accounts) {
    const res = await user.api('/api/google/sync', { method: 'POST', body: JSON.stringify({ google_account_id: account.id }) })
    expect(res.status).toBe(200)
  }
}

describe('Google sync against a fake server', () => {
  beforeEach(() => fakes('reset'))

  describe('first connect', () => {
    it('brings in every calendar and its events, not just the primary', async () => {
      const email = newEmail()
      await fakes('google/add-account', {
        email,
        calendars: [
          { id: email, summary: 'Main', primary: true },
          { id: 'work@group.test', summary: 'Work' },
          { id: 'family@group.test', summary: 'Family', accessRole: 'reader' },
        ],
      })
      await fakes('google/put-event', { email, calendarId: email, event: remoteEvent('a', 'On main') })
      await fakes('google/put-event', { email, calendarId: 'work@group.test', event: remoteEvent('b', 'On work') })
      await fakes('google/put-event', { email, calendarId: 'family@group.test', event: remoteEvent('c', 'On family') })

      const user = await createUser('gs-a')
      await connect(user, email)

      const cals = await calendars(user)
      expect(cals.map((c) => c.name).sort()).toEqual(['Family', 'Main', 'Work'])
      expect(cals.every((c) => c.is_active)).toBe(true)
      expect((await events(user)).map((e) => e.title).sort()).toEqual(['On family', 'On main', 'On work'])
    })

    it('connects a second account to the same user', async () => {
      const first = newEmail()
      const second = newEmail()
      await fakes('google/add-account', { email: first })
      await fakes('google/add-account', { email: second })
      const user = await createUser('gs-b')
      await connect(user, first)
      await connect(user, second)
      expect(await calendars(user)).toHaveLength(2)
    })

    it('stores Google tokens encrypted', async () => {
      const email = newEmail()
      await fakes('google/add-account', { email })
      const user = await createUser('gs-c')
      await connect(user, email)
      const { data } = await serviceClient()
        .from('google_accounts')
        .select('access_token, refresh_token')
        .eq('user_id', user.id)
        .single()
      expect(data!.access_token.startsWith('v1:')).toBe(true)
      expect(data!.refresh_token.startsWith('v1:')).toBe(true)
    })
  })

  describe('the calendar picker', () => {
    async function twoCalendars() {
      const email = newEmail()
      await fakes('google/add-account', {
        email,
        calendars: [{ id: email, summary: 'Main', primary: true }, { id: 'work@group.test', summary: 'Work' }],
      })
      await fakes('google/put-event', { email, calendarId: 'work@group.test', event: remoteEvent('w1', 'Work event') })
      const user = await createUser('gs-d')
      await connect(user, email)
      const work = (await calendars(user)).find((c) => c.name === 'Work')!
      return { email, user, work }
    }

    it('hides a calendar turned off, and stops pulling it', async () => {
      const { email, user, work } = await twoCalendars()
      const off = await user.api(`/api/calendars/${work.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) })
      expect(off.status).toBe(200)
      expect(await events(user)).toHaveLength(0)

      await fakes('google/put-event', { email, calendarId: 'work@group.test', event: remoteEvent('w2', 'Added while off') })
      await pull(user)
      const { data } = await serviceClient().from('events').select('title').eq('calendar_id', work.id)
      expect(data!.map((e) => e.title)).toEqual(['Work event'])
    })

    it('catches up when turned back on', async () => {
      const { email, user, work } = await twoCalendars()
      await user.api(`/api/calendars/${work.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) })
      await fakes('google/put-event', { email, calendarId: 'work@group.test', event: remoteEvent('w2', 'Added while off') })
      await user.api(`/api/calendars/${work.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) })
      await pull(user)
      expect((await events(user)).map((e) => e.title).sort()).toEqual(['Added while off', 'Work event'])
    })

    it('keeps the choice when the calendar list refreshes, and picks up new calendars', async () => {
      const { email, user, work } = await twoCalendars()
      await user.api(`/api/calendars/${work.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) })
      await fakes('google/add-calendar', { email, id: 'new@group.test', summary: 'New one' })
      await pull(user)
      const cals = await calendars(user)
      expect(cals.find((c) => c.name === 'Work')!.is_active).toBe(false)
      expect(cals.find((c) => c.name === 'New one')!.is_active).toBe(true)
    })
  })

  describe('Google to the app', () => {
    async function connected() {
      const email = newEmail()
      await fakes('google/add-account', { email })
      const user = await createUser('gs-e')
      await connect(user, email)
      return { email, user }
    }

    it('brings in new, changed and deleted events', async () => {
      const { email, user } = await connected()
      await fakes('google/put-event', { email, calendarId: email, event: remoteEvent('x', 'Made on Google') })
      await pull(user)
      expect((await events(user)).map((e) => e.title)).toEqual(['Made on Google'])

      await fakes('google/put-event', { email, calendarId: email, event: { id: 'x', summary: 'Renamed on Google' } })
      await pull(user)
      expect((await events(user)).map((e) => e.title)).toEqual(['Renamed on Google'])

      await fakes('google/cancel-event', { email, calendarId: email, id: 'x' })
      await pull(user)
      expect(await events(user)).toEqual([])
    })

    it('keeps a separate sync token for each calendar', async () => {
      const email = newEmail()
      await fakes('google/add-account', {
        email,
        calendars: [{ id: email, summary: 'Main', primary: true }, { id: 'work@group.test', summary: 'Work' }],
      })
      const user = await createUser('gs-f')
      await connect(user, email)
      await pull(user)
      // The fake refuses a token used on the wrong calendar, as Google does.
      await fakes('google/put-event', { email, calendarId: 'work@group.test', event: remoteEvent('w', 'Second pull') })
      await pull(user)
      expect((await events(user)).map((e) => e.title)).toEqual(['Second pull'])
      const { data } = await serviceClient().from('calendars').select('sync_token').eq('google_account_id', (await user.api('/api/calendars').then((r) => r.json()) as { accounts: { id: string }[] }).accounts[0]!.id)
      expect(new Set(data!.map((c) => c.sync_token)).size).toBe(2)
    })

    it('recovers when Google expires a sync token', async () => {
      const { email, user } = await connected()
      await pull(user)
      await fakes('google/put-event', { email, calendarId: email, event: remoteEvent('y', 'After expiry') })
      await fakes('google/expire-sync-tokens', { email, calendarId: email })
      await pull(user)
      expect((await events(user)).map((e) => e.title)).toEqual(['After expiry'])
    })

    it('shows a recurring series and honours a cancelled occurrence', async () => {
      const { email, user } = await connected()
      await fakes('google/put-event', {
        email,
        calendarId: email,
        event: remoteEvent('series', 'Daily on Google', '07', { recurrence: ['RRULE:FREQ=DAILY;COUNT=7'] }),
      })
      await pull(user)
      expect(await events(user)).toHaveLength(7)

      await fakes('google/put-event', {
        email,
        calendarId: email,
        event: {
          id: 'series_20300109T100000Z',
          recurringEventId: 'series',
          originalStartTime: { dateTime: '2030-01-09T10:00:00Z' },
          status: 'cancelled',
        },
      })
      await pull(user)
      expect(await events(user)).toHaveLength(6)
    })

    it('does not take Google\'s copy over an edit still waiting to go out', async () => {
      const { email, user } = await connected()
      await fakes('google/put-event', { email, calendarId: email, event: remoteEvent('z', 'Original') })
      await pull(user)
      const local = (await events(user))[0]!

      await fakes('google/fail-next', { key: 'PATCH /events/', status: 500 })
      const edited = await user.api(`/api/events/${local.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Edited here' }) })
      expect(edited.status).toBe(200)

      await fakes('google/put-event', { email, calendarId: email, event: { id: 'z', summary: 'Edited there' } })
      const accounts = (await (await user.api('/api/calendars')).json()) as { accounts: { id: string }[] }
      await serviceClient().from('events').update({ next_retry_at: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', local.id)
      await user.api('/api/google/sync', { method: 'POST', body: JSON.stringify({ google_account_id: accounts.accounts[0]!.id }) })
      expect((await events(user))[0]!.title).toBe('Edited here')
    })
  })

  describe('the app to Google', () => {
    async function connected() {
      const email = newEmail()
      await fakes('google/add-account', { email })
      const user = await createUser('gs-g')
      await connect(user, email)
      const calendarId = (await calendars(user))[0]!.id
      return { email, user, calendarId }
    }
    const body = (calendarId: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        calendar_id: calendarId,
        title: 'Made here',
        start_time: '2030-01-08T10:00:00.000Z',
        end_time: '2030-01-08T11:00:00.000Z',
        timezone: 'UTC',
        ...extra,
      })

    it('pushes creates, edits and deletes through the API', async () => {
      const { email, user, calendarId } = await connected()
      const created = (await (await user.api('/api/events', { method: 'POST', body: body(calendarId) })).json()) as { id: string; sync_status: string; google_event_id: string }
      expect(created.sync_status).toBe('synced')
      expect(created.google_event_id).toBeTruthy()
      expect((await remoteEvents(email, email)).map((e) => e.summary)).toEqual(['Made here'])

      await user.api(`/api/events/${created.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed here' }) })
      expect((await remoteEvents(email, email))[0]!.summary).toBe('Renamed here')

      await user.api(`/api/events/${created.id}`, { method: 'DELETE' })
      expect((await remoteEvents(email, email))[0]!.status).toBe('cancelled')
    })

    it('retries a push that failed', async () => {
      const { email, user, calendarId } = await connected()
      await fakes('google/fail-next', { key: 'POST /events', status: 500 })
      const created = (await (await user.api('/api/events', { method: 'POST', body: body(calendarId) })).json()) as { sync_status: string }
      expect(created.sync_status).toBe('pending_push')
      expect(await remoteEvents(email, email)).toEqual([])

      expect((await cron('sync-poll')).status).toBe(200)
      expect((await remoteEvents(email, email)).map((e) => e.summary)).toEqual(['Made here'])
    })

    it('carries over an edit made straight from the browser', async () => {
      const { email, user, calendarId } = await connected()
      // The UI writes directly to the database and marks the row pending_push.
      const { error } = await user.client.from('events').insert({
        user_id: user.id,
        calendar_id: calendarId,
        title: 'From the browser',
        start_time: '2030-01-08T10:00:00.000Z',
        end_time: '2030-01-08T11:00:00.000Z',
        timezone: 'UTC',
        sync_status: 'pending_push',
      })
      expect(error).toBeNull()
      expect((await user.api('/api/google/sync', { method: 'POST' })).status).toBe(200)
      expect((await remoteEvents(email, email)).map((e) => e.summary)).toEqual(['From the browser'])
    })

    it('carries over a delete made straight from the browser', async () => {
      const { email, user, calendarId } = await connected()
      const created = (await (await user.api('/api/events', { method: 'POST', body: body(calendarId) })).json()) as { id: string }
      const del = await user.client.from('events').delete().eq('id', created.id)
      expect(del.error).toBeNull()

      expect((await user.api('/api/google/sync', { method: 'POST' })).status).toBe(200)
      expect((await remoteEvents(email, email))[0]!.status).toBe('cancelled')
      // It stays gone after the next pull rather than coming back.
      await pull(user)
      expect(await events(user)).toEqual([])
    })

    it('leaves Google alone when an account is disconnected', async () => {
      const { email, user, calendarId } = await connected()
      await user.api('/api/events', { method: 'POST', body: body(calendarId) })
      const accounts = (await (await user.api('/api/calendars')).json()) as { accounts: { id: string }[] }
      const res = await browserApi(user, `/api/google/disconnect/${accounts.accounts[0]!.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const { data } = await serviceClient().from('google_event_tombstones').select('id').eq('user_id', user.id)
      expect(data).toEqual([])
      expect((await remoteEvents(email, email))[0]!.status).toBe('confirmed')
      expect(await calendars(user)).toEqual([])
    })

    it('pushes changes to part of a recurring series', async () => {
      const { email, user, calendarId } = await connected()
      const created = (await (await user.api('/api/events', {
        method: 'POST',
        body: body(calendarId, { title: 'Series', start_time: '2030-01-07T10:00:00.000Z', end_time: '2030-01-07T11:00:00.000Z', recurrence_rule: 'FREQ=DAILY;COUNT=7' }),
      })).json()) as { id: string }
      expect((await user.api(`/api/events/${created.id}?scope=single&occurrence_start=2030-01-09T10:00:00.000Z`, { method: 'DELETE' })).status).toBe(204)
      expect((await user.api('/api/google/sync', { method: 'POST' })).status).toBe(200)

      const { items } = await fakes<{ items: { recurrence?: string[] }[] }>('google/list-events', { email, calendarId: email })
      expect(items[0]!.recurrence).toEqual(['RRULE:FREQ=DAILY;COUNT=7', 'EXDATE:20300109T100000Z'])
    })
  })

  describe('access', () => {
    it("won't sync an account the caller doesn't own", async () => {
      const email = newEmail()
      await fakes('google/add-account', { email })
      const owner = await createUser('gs-h')
      await connect(owner, email)
      const accounts = (await (await owner.api('/api/calendars')).json()) as { accounts: { id: string }[] }

      const other = await createUser('gs-i')
      const res = await other.api('/api/google/sync', { method: 'POST', body: JSON.stringify({ google_account_id: accounts.accounts[0]!.id }) })
      expect(res.status).toBe(404)
    })

    it('keeps sync bookkeeping away from users', async () => {
      const user = await createUser('gs-j')
      for (const table of ['google_event_tombstones', 'scheduler_leases']) {
        const { error } = await user.client.from(table).select('*')
        expect(error?.code).toBe('42501')
      }
      const { error } = await user.client.rpc('try_scheduler_lease', { p_name: 'x', p_seconds: 1 })
      expect(error?.code).toBe('42501')
    })
  })
})

describe('the built-in scheduler', () => {
  let second: ChildProcess | undefined

  afterAll(() => {
    second?.kill('SIGTERM')
  })

  it('syncs on its own, with nothing calling it', async () => {
    await fakes('reset')
    const email = newEmail()
    await fakes('google/add-account', { email })
    const user = await createUser('gs-k')
    await connect(user, email)

    // A second copy of the app with the scheduler on, every 2 seconds.
    const env = JSON.parse(readFileSync(process.env.MEOW_APP_ENV_FILE as string, 'utf8')) as NodeJS.ProcessEnv
    second = spawn('pnpm', ['--filter', '@poolendar/web', 'exec', 'next', 'start', '-p', '3211'], {
      env: { ...env, SCHEDULER_INTERVAL_SECONDS: '2' },
      cwd: new URL('../../..', import.meta.url).pathname,
      stdio: 'ignore',
    })

    await fakes('google/put-event', { email, calendarId: email, event: remoteEvent('auto', 'Arrived by itself') })

    let titles: string[] = []
    for (let i = 0; i < 60; i++) {
      // Make the account look stale, so the poll picks it up on its next round.
      await serviceClient().from('google_accounts').update({ last_synced_at: null }).eq('user_id', user.id)
      await new Promise((r) => setTimeout(r, 1000))
      titles = (await events(user)).map((e) => e.title)
      if (titles.length) break
    }
    expect(titles).toEqual(['Arrived by itself'])
  }, 90_000)
})
