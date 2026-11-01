import { describe, it, expect, beforeEach } from 'vitest'
import { APP, browserApi, createUser, fakes, publicClient, serviceClient, type TestUser } from './helpers'

// Against a local fake Google server, not Google.

interface RemoteEvent {
  id: string
  summary: string
  status: string
  start: { dateTime: string }
  extendedProperties?: { private?: Record<string, string> }
}

let n = 0
const newEmail = () => `tasks${Date.now().toString(36)}${++n}@gmail.test`

async function connect(user: TestUser, email: string) {
  await fakes('google/login-as', { email })
  const { data } = await publicClient().auth.signInWithPassword({ email: user.email, password: user.password })
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.split('.')[0]
  let cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`
  const start = await fetch(`${APP}/api/google/connect`, { headers: { Cookie: cookie }, redirect: 'manual' })
  cookie = `${cookie}; ${start.headers.getSetCookie().find((c) => c.startsWith('oauth_state='))!.split(';')[0]}`
  const atGoogle = await fetch(start.headers.get('location')!, { redirect: 'manual' })
  await fetch(atGoogle.headers.get('location')!, { headers: { Cookie: cookie }, redirect: 'manual' })
}

async function setup(prefix: string, calendars?: unknown[]) {
  const email = newEmail()
  await fakes('google/add-account', { email, calendars })
  const user = await createUser(prefix)
  await connect(user, email)
  const body = (await (await user.api('/api/calendars')).json()) as {
    accounts: { id: string; calendars: { id: string; name: string; google_calendar_id: string; access_role: string }[] }[]
    local_calendars: { id: string }[]
  }
  return { email, user, accountId: body.accounts[0]!.id, calendars: body.accounts[0]!.calendars, local: body.local_calendars[0]! }
}

const remote = async (email: string, calendarId: string) =>
  (await fakes<{ items: RemoteEvent[] }>('google/list-events', { email, calendarId })).items

/** The sync the open app runs. Throttled pulls don't apply with an explicit account. */
async function sync(user: TestUser, accountId?: string) {
  const res = await user.api('/api/google/sync', {
    method: 'POST',
    body: accountId ? JSON.stringify({ google_account_id: accountId }) : undefined,
  })
  expect(res.status).toBe(200)
}

async function turnOn(user: TestUser, calendarId: string | null) {
  const res = await user.api('/api/tasks/google-sync', { method: 'PUT', body: JSON.stringify({ calendar_id: calendarId }) })
  expect(res.status).toBe(200)
}

async function scheduledTask(user: TestUser, title = 'Write report') {
  const res = await user.api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      scheduled_start: '2030-01-08T10:00:00.000Z',
      scheduled_end: '2030-01-08T11:00:00.000Z',
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

const eventRows = async (user: TestUser) =>
  (await serviceClient().from('events').select('id, title').eq('user_id', user.id)).data ?? []

describe('scheduled tasks on Google, against a fake server', () => {
  beforeEach(() => fakes('reset'))

  it('sends nothing until a calendar is chosen', async () => {
    const { email, user } = await setup('tg-a')
    await scheduledTask(user)
    await sync(user)
    expect(await remote(email, email)).toEqual([])
  })

  it('sends tasks to the chosen calendar, with existing ones included', async () => {
    const { email, user, calendars } = await setup('tg-b')
    const before = await scheduledTask(user, 'Already scheduled')
    await turnOn(user, calendars[0]!.id)
    await sync(user)

    const events = await remote(email, email)
    expect(events.map((e) => e.summary)).toEqual(['Already scheduled'])
    expect(events[0]!.extendedProperties?.private?.meowlendarTaskId).toBe(before.id)
  })

  it('sends only to the chosen calendar', async () => {
    const email = newEmail()
    await fakes('google/add-account', {
      email,
      calendars: [{ id: email, summary: 'Main', primary: true }, { id: 'tasks@group.test', summary: 'Tasks' }],
    })
    const user = await createUser('tg-c')
    await connect(user, email)
    const body = (await (await user.api('/api/calendars')).json()) as { accounts: { calendars: { id: string; name: string }[] }[] }
    await turnOn(user, body.accounts[0]!.calendars.find((c) => c.name === 'Tasks')!.id)
    await scheduledTask(user)
    await sync(user)
    expect((await remote(email, 'tasks@group.test')).map((e) => e.summary)).toEqual(['Write report'])
    expect(await remote(email, email)).toEqual([])
  })

  it('never shows up twice: the pull does not create an event row', async () => {
    const { email, user, calendars, accountId } = await setup('tg-d')
    await turnOn(user, calendars[0]!.id)
    await scheduledTask(user)
    await sync(user)
    await sync(user, accountId)
    await sync(user, accountId)
    expect(await remote(email, email)).toHaveLength(1)
    expect(await eventRows(user)).toEqual([])
  })

  it('does not bounce: a pull of our own write causes no further write', async () => {
    const { email, user, calendars, accountId } = await setup('tg-e')
    await turnOn(user, calendars[0]!.id)
    await scheduledTask(user)
    await sync(user)
    await sync(user, accountId)

    const count = async () => {
      const { requests } = await fakes<{ requests: { method: string; path: string }[] }>('google/state')
      return requests.filter((r) => r.method !== 'GET' && r.path.includes('/events')).length
    }
    const writes = await count()
    await sync(user, accountId)
    await sync(user, accountId)
    expect(await count()).toBe(writes)
    const { data } = await serviceClient().from('tasks').select('google_dirty').eq('user_id', user.id)
    expect(data![0]!.google_dirty).toBe(false)
  })

  it('keeps the event updated with edits, including ones made in the browser', async () => {
    const { email, user, calendars } = await setup('tg-f')
    await turnOn(user, calendars[0]!.id)
    const task = await scheduledTask(user)
    await sync(user)

    await user.api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) })
    await sync(user)
    expect((await remote(email, email))[0]!.summary).toBe('Renamed')

    // The UI writes straight to the database.
    await user.client.from('tasks').update({ scheduled_start: '2030-01-09T12:00:00.000Z', scheduled_end: '2030-01-09T13:00:00.000Z' }).eq('id', task.id)
    await sync(user)
    const event = (await remote(email, email))[0]!
    expect(event.start.dateTime).toContain('2030-01-09T12:00:00')
    expect(await remote(email, email)).toHaveLength(1)
  })

  it('marks a completed task on the event', async () => {
    const { email, user, calendars } = await setup('tg-g')
    await turnOn(user, calendars[0]!.id)
    const task = await scheduledTask(user)
    await sync(user)
    expect((await user.api(`/api/tasks/${task.id}/complete`, { method: 'POST' })).status).toBe(200)
    await sync(user)
    expect((await remote(email, email))[0]!.summary).toBe('✓ Write report')
  })

  it('removes the event when a task is unscheduled or deleted', async () => {
    const { email, user, calendars } = await setup('tg-h')
    await turnOn(user, calendars[0]!.id)
    const a = await scheduledTask(user, 'Unschedule me')
    const b = await scheduledTask(user, 'Delete me')
    await sync(user)
    expect((await remote(email, email)).filter((e) => e.status === 'confirmed')).toHaveLength(2)

    await user.client.from('tasks').update({ scheduled_start: null, scheduled_end: null }).eq('id', a.id)
    await user.client.from('tasks').delete().eq('id', b.id)
    await sync(user)
    expect((await remote(email, email)).filter((e) => e.status === 'confirmed')).toEqual([])
    const { data } = await serviceClient().from('tasks').select('google_event_id').eq('id', a.id).single()
    expect(data!.google_event_id).toBeNull()
  })

  it('brings changes made on Google back to the task', async () => {
    const { email, user, calendars, accountId } = await setup('tg-i')
    await turnOn(user, calendars[0]!.id)
    const task = await scheduledTask(user)
    await sync(user)
    const event = (await remote(email, email))[0]!

    await fakes('google/put-event', {
      email,
      calendarId: email,
      event: {
        id: event.id,
        summary: 'Moved on Google',
        start: { dateTime: '2030-01-10T15:00:00Z' },
        end: { dateTime: '2030-01-10T16:00:00Z' },
      },
    })
    await sync(user, accountId)

    const { data } = await serviceClient().from('tasks').select('title, scheduled_start, google_dirty').eq('id', task.id).single()
    expect(data!.title).toBe('Moved on Google')
    expect(new Date(data!.scheduled_start).toISOString()).toBe('2030-01-10T15:00:00.000Z')
    expect(data!.google_dirty).toBe(false)
    expect(await eventRows(user)).toEqual([])
  })

  it('unschedules the task when the event is deleted on Google', async () => {
    const { email, user, calendars, accountId } = await setup('tg-j')
    await turnOn(user, calendars[0]!.id)
    const task = await scheduledTask(user)
    await sync(user)
    await sync(user, accountId)
    const event = (await remote(email, email))[0]!
    await fakes('google/cancel-event', { email, calendarId: email, id: event.id })
    await sync(user, accountId)

    const { data } = await serviceClient().from('tasks').select('title, scheduled_start, google_event_id').eq('id', task.id).single()
    expect(data).toMatchObject({ title: 'Write report', scheduled_start: null, google_event_id: null })
    // It stays gone rather than being pushed straight back.
    await sync(user)
    expect((await remote(email, email)).filter((e) => e.status === 'confirmed')).toEqual([])
  })

  it('keeps an edit made here when both sides changed', async () => {
    const { email, user, calendars, accountId } = await setup('tg-k')
    await turnOn(user, calendars[0]!.id)
    const task = await scheduledTask(user)
    await sync(user)
    const event = (await remote(email, email))[0]!

    await user.client.from('tasks').update({ title: 'Edited here' }).eq('id', task.id)
    await fakes('google/put-event', { email, calendarId: email, event: { id: event.id, summary: 'Edited there' } })
    // The pull runs after the push in this order, so make the pull see Google's copy first.
    await sync(user, accountId)
    await sync(user, accountId)
    expect((await remote(email, email))[0]!.summary).toBe('Edited here')
    const { data } = await serviceClient().from('tasks').select('title').eq('id', task.id).single()
    expect(data!.title).toBe('Edited here')
  })

  it('retries after a failure', async () => {
    const { email, user, calendars } = await setup('tg-l')
    await turnOn(user, calendars[0]!.id)
    await fakes('google/fail-next', { key: 'POST /events', status: 500 })
    const task = await scheduledTask(user)
    await sync(user)
    expect(await remote(email, email)).toEqual([])
    const { data } = await serviceClient().from('tasks').select('google_retry_count').eq('id', task.id).single()
    expect(data!.google_retry_count).toBe(1)

    await serviceClient().from('tasks').update({ google_next_retry_at: null }).eq('id', task.id)
    await sync(user)
    expect(await remote(email, email)).toHaveLength(1)
  })

  it('takes events down when turned off, and moves them when the calendar changes', async () => {
    const email = newEmail()
    await fakes('google/add-account', {
      email,
      calendars: [{ id: email, summary: 'Main', primary: true }, { id: 'other@group.test', summary: 'Other' }],
    })
    const user = await createUser('tg-m')
    await connect(user, email)
    const body = (await (await user.api('/api/calendars')).json()) as { accounts: { calendars: { id: string; name: string }[] }[] }
    const main = body.accounts[0]!.calendars.find((c) => c.name === 'Main')!
    const other = body.accounts[0]!.calendars.find((c) => c.name === 'Other')!

    await turnOn(user, main.id)
    await scheduledTask(user)
    await sync(user)
    expect((await remote(email, email)).filter((e) => e.status === 'confirmed')).toHaveLength(1)

    await turnOn(user, other.id)
    await sync(user)
    expect((await remote(email, email)).filter((e) => e.status === 'confirmed')).toEqual([])
    expect((await remote(email, 'other@group.test')).filter((e) => e.status === 'confirmed')).toHaveLength(1)

    await turnOn(user, null)
    await sync(user)
    expect((await remote(email, 'other@group.test')).filter((e) => e.status === 'confirmed')).toEqual([])
    const { data } = await serviceClient().from('tasks').select('title, google_event_id, scheduled_start').eq('user_id', user.id)
    expect(data![0]).toMatchObject({ title: 'Write report', google_event_id: null })
    expect(data![0]!.scheduled_start).not.toBeNull()
  })

  describe('choosing a calendar', () => {
    it('refuses a local calendar, a read-only one, and someone else\'s', async () => {
      const email = newEmail()
      await fakes('google/add-account', {
        email,
        calendars: [{ id: email, summary: 'Main', primary: true }, { id: 'ro@group.test', summary: 'Holidays', accessRole: 'reader' }],
      })
      const user = await createUser('tg-n')
      await connect(user, email)
      const body = (await (await user.api('/api/calendars')).json()) as {
        accounts: { calendars: { id: string; name: string }[] }[]
        local_calendars: { id: string }[]
      }
      const put = (calendar_id: string) => user.api('/api/tasks/google-sync', { method: 'PUT', body: JSON.stringify({ calendar_id }) })

      expect((await put(body.local_calendars[0]!.id)).status).toBe(422)
      expect((await put(body.accounts[0]!.calendars.find((c) => c.name === 'Holidays')!.id)).status).toBe(422)

      const { user: other, calendars: theirs } = await setup('tg-o')
      expect(other.id).not.toBe(user.id)
      expect((await put(theirs[0]!.id)).status).toBe(404)
      expect((await user.api('/api/tasks/google-sync', { method: 'PUT', body: JSON.stringify({ calendar_id: 'nope' }) })).status).toBe(422)
    })

    it('ignores a calendar written straight into settings that is not theirs', async () => {
      const { email, calendars } = await setup('tg-p')
      const attacker = await createUser('tg-q')
      const { data } = await attacker.client.from('profiles').select('settings').eq('id', attacker.id).single()
      await attacker.client
        .from('profiles')
        .update({ settings: { ...data!.settings, task_sync_calendar_id: calendars[0]!.id } })
        .eq('id', attacker.id)
      await scheduledTask(attacker, 'Attacker task')
      await sync(attacker)
      expect(await remote(email, email)).toEqual([])
    })

    it('needs a signed-in caller', async () => {
      const res = await fetch(`${APP}/api/tasks/google-sync`, { method: 'PUT', body: '{}' })
      expect(res.status).toBe(401)
    })

    it('reads the current choice back', async () => {
      const { user, calendars } = await setup('tg-r')
      await turnOn(user, calendars[0]!.id)
      const res = await browserApi(user, '/api/tasks/google-sync')
      expect(await res.json()).toEqual({ calendar_id: calendars[0]!.id })
    })
  })

  it('does not let an event claim a task belonging to someone else', async () => {
    const victim = await createUser('tg-s')
    const task = await scheduledTask(victim, 'Victim task')
    const { email, user, accountId } = await setup('tg-t')
    await fakes('google/put-event', {
      email,
      calendarId: email,
      event: {
        id: 'forged',
        summary: 'Hijacked',
        start: { dateTime: '2030-01-10T15:00:00Z' },
        end: { dateTime: '2030-01-10T16:00:00Z' },
        extendedProperties: { private: { meowlendarTaskId: task.id } },
      },
    })
    await sync(user, accountId)
    const { data } = await serviceClient().from('tasks').select('title').eq('id', task.id).single()
    expect(data!.title).toBe('Victim task')
  })
})
