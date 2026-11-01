import { describe, it, expect } from 'vitest'
import { browserApi, createUser, serviceClient } from './helpers'

interface Item {
  id: string
  kind: string
  title?: string
  start_time?: string
  occurrence_start?: string
}

const WEEK = { start: '2030-01-07T00:00:00.000Z', end: '2030-01-13T23:59:59.000Z' } // Mon to Sun

async function setup(prefix: string) {
  const user = await createUser(prefix)
  const calendars = (await (await user.api('/api/calendars')).json()) as {
    accounts: unknown[]
    local_calendars: { id: string; name: string; source: string; google_account_id: string | null }[]
  }
  return { user, calendar: calendars.local_calendars[0]!, calendars }
}

async function list(user: Awaited<ReturnType<typeof createUser>>) {
  const res = await user.api(`/api/events?start=${WEEK.start}&end=${WEEK.end}&include=events`)
  expect(res.status).toBe(200)
  return ((await res.json()) as { items: Item[] }).items
}

function eventBody(calendarId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    calendar_id: calendarId,
    title: 'Standup',
    start_time: '2030-01-07T14:00:00.000Z',
    end_time: '2030-01-07T14:30:00.000Z',
    timezone: 'UTC',
    ...extra,
  })
}

describe('local calendars, with no Google account', () => {
  it('gives every new user one', async () => {
    const { calendars, calendar } = await setup('lc-a')
    expect(calendars.accounts).toEqual([])
    expect(calendar).toMatchObject({ source: 'local', name: 'My Calendar', google_account_id: null })
  })

  it('creates, reads, edits and deletes an event', async () => {
    const { user, calendar } = await setup('lc-b')
    const created = await user.api('/api/events', { method: 'POST', body: eventBody(calendar.id) })
    expect(created.status).toBe(201)
    const event = (await created.json()) as { id: string; sync_status: string; google_event_id: null }
    expect(event.sync_status).toBe('synced')
    expect(event.google_event_id).toBeNull()

    const edited = await user.api(`/api/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) })
    expect(edited.status).toBe(200)
    expect(((await edited.json()) as { title: string }).title).toBe('Renamed')

    expect(await list(user)).toHaveLength(1)
    expect((await user.api(`/api/events/${event.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await list(user)).toHaveLength(0)
  })

  it('never leaves an event waiting to sync, even when the client asks', async () => {
    const { user, calendar } = await setup('lc-c')
    const { data, error } = await user.client
      .from('events')
      .insert({
        user_id: user.id,
        calendar_id: calendar.id,
        title: 'From the browser',
        start_time: WEEK.start,
        end_time: WEEK.start,
        timezone: 'UTC',
        sync_status: 'pending_push',
      })
      .select('sync_status')
      .single()
    expect(error).toBeNull()
    expect(data!.sync_status).toBe('synced')
  })

  it('expands a recurring event across the window', async () => {
    const { user, calendar } = await setup('lc-d')
    await user.api('/api/events', {
      method: 'POST',
      // Starts a year before the window, so only expansion can find it.
      body: eventBody(calendar.id, {
        start_time: '2029-01-01T14:00:00.000Z',
        end_time: '2029-01-01T14:30:00.000Z',
        recurrence_rule: 'FREQ=DAILY',
      }),
    })
    const items = await list(user)
    expect(items).toHaveLength(7)
    expect(items[0]!.start_time).toBe('2030-01-07T14:00:00.000Z')
    expect(items[0]!.occurrence_start).toBe('2030-01-07T14:00:00.000Z')
  })

  it('refuses an invalid recurrence rule', async () => {
    const { user, calendar } = await setup('lc-e')
    const res = await user.api('/api/events', { method: 'POST', body: eventBody(calendar.id, { recurrence_rule: 'nope' }) })
    expect(res.status).toBe(422)
  })

  describe('editing part of a series', () => {
    async function series(prefix: string) {
      const { user, calendar } = await setup(prefix)
      const res = await user.api('/api/events', {
        method: 'POST',
        body: eventBody(calendar.id, { recurrence_rule: 'FREQ=DAILY;COUNT=7' }),
      })
      const event = (await res.json()) as { id: string }
      return { user, id: event.id, calendar }
    }
    const WED = '2030-01-09T14:00:00.000Z'

    it('moves one occurrence and leaves the rest', async () => {
      const { user, id } = await series('lc-f')
      const res = await user.api(`/api/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          scope: 'single',
          occurrence_start: WED,
          start_time: '2030-01-09T18:00:00.000Z',
          end_time: '2030-01-09T18:30:00.000Z',
          title: 'Moved',
        }),
      })
      expect(res.status).toBe(200)
      const items = await list(user)
      expect(items).toHaveLength(7)
      expect(items.filter((i) => i.start_time === WED)).toHaveLength(0)
      expect(new Date(items.find((i) => i.title === 'Moved')!.start_time!).toISOString()).toBe('2030-01-09T18:00:00.000Z')
    })

    it('changes this and later occurrences', async () => {
      const { user, id } = await series('lc-g')
      const res = await user.api(`/api/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scope: 'future', occurrence_start: WED, title: 'Later' }),
      })
      expect(res.status).toBe(200)
      const items = await list(user)
      expect(items).toHaveLength(7)
      expect(items.filter((i) => i.title === 'Standup')).toHaveLength(2)
      expect(items.filter((i) => i.title === 'Later')).toHaveLength(5)
    })

    it('changes the whole series, shifting it by the edited amount', async () => {
      const { user, id } = await series('lc-h')
      const res = await user.api(`/api/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          scope: 'all',
          occurrence_start: WED,
          start_time: '2030-01-09T15:00:00.000Z',
          end_time: '2030-01-09T15:30:00.000Z',
        }),
      })
      expect(res.status).toBe(200)
      const items = await list(user)
      expect(items).toHaveLength(7)
      expect(items.every((i) => i.start_time!.includes('T15:00:00'))).toBe(true)
    })

    it('deletes one occurrence', async () => {
      const { user, id } = await series('lc-i')
      const res = await user.api(`/api/events/${id}?scope=single&occurrence_start=${encodeURIComponent(WED)}`, { method: 'DELETE' })
      expect(res.status).toBe(204)
      const items = await list(user)
      expect(items).toHaveLength(6)
      expect(items.some((i) => i.start_time === WED)).toBe(false)
    })

    it('deletes this and later', async () => {
      const { user, id } = await series('lc-j')
      await user.api(`/api/events/${id}?scope=future&occurrence_start=${encodeURIComponent(WED)}`, { method: 'DELETE' })
      expect(await list(user)).toHaveLength(2)
    })

    it('deletes the whole series and its moved occurrences', async () => {
      const { user, id } = await series('lc-k')
      await user.api(`/api/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scope: 'single', occurrence_start: WED, title: 'Moved' }),
      })
      expect((await user.api(`/api/events/${id}?scope=all`, { method: 'DELETE' })).status).toBe(204)
      expect(await list(user)).toHaveLength(0)
    })

    it('asks for the occurrence when the scope needs one', async () => {
      const { user, id } = await series('lc-l')
      const res = await user.api(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify({ scope: 'single', title: 'x' }) })
      expect(res.status).toBe(422)
    })
  })

  describe('alongside the rest of the app', () => {
    it('lets a task point at a local calendar', async () => {
      const { user, calendar } = await setup('lc-m')
      const res = await user.api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Scheduled',
          calendar_id: calendar.id,
          scheduled_start: '2030-01-08T10:00:00.000Z',
          scheduled_end: '2030-01-08T11:00:00.000Z',
        }),
      })
      expect(res.status).toBe(201)
    })

    it('blocks booking slots with local events, including recurring ones', async () => {
      const { user, calendar } = await setup('lc-n')
      const slug = `local-${Date.now().toString(36)}`
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
        day,
        start: '09:00',
        end: '12:00',
      }))
      const { error } = await user.client.from('booking_links').insert({
        user_id: user.id,
        slug,
        name: 'Local',
        duration_minutes: 60,
        availability: days,
        timezone: 'UTC',
        conferencing: false,
        is_public: true,
      })
      expect(error).toBeNull()

      const slotsOn = async (date: string) => {
        const res = await fetch(`${process.env.MEOW_APP_URL}/api/booking/availability/${slug}?date=${date}&timezone=UTC`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { slots: { start: string }[] }
        return body.slots.map((s) => s.start)
      }
      const date = '2030-01-08'
      expect(await slotsOn(date)).toContain('2030-01-08T10:00:00.000Z')

      await user.api('/api/events', {
        method: 'POST',
        body: eventBody(calendar.id, {
          start_time: '2029-12-01T10:00:00.000Z',
          end_time: '2029-12-01T11:00:00.000Z',
          recurrence_rule: 'FREQ=DAILY',
        }),
      })
      const after = await slotsOn(date)
      expect(after).not.toContain('2030-01-08T10:00:00.000Z')
      expect(after).toContain('2030-01-08T09:00:00.000Z')
    })

    it('creates and refuses to delete the last local calendar', async () => {
      const { user, calendar } = await setup('lc-o')
      expect((await user.api(`/api/calendars/${calendar.id}`, { method: 'DELETE' })).status).toBe(409)

      const created = await user.api('/api/calendars', { method: 'POST', body: JSON.stringify({ name: 'Second' }) })
      expect(created.status).toBe(201)
      const second = (await created.json()) as { id: string }

      const renamed = await user.api(`/api/calendars/${second.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) })
      expect(((await renamed.json()) as { name: string }).name).toBe('Renamed')

      const ev = await user.api('/api/events', { method: 'POST', body: eventBody(second.id) })
      expect(ev.status).toBe(201)
      expect((await user.api(`/api/calendars/${second.id}`, { method: 'DELETE' })).status).toBe(200)
      expect(await list(user)).toHaveLength(0)
    })

    it('rejects a bad calendar name', async () => {
      const { user } = await setup('lc-p')
      const res = await user.api('/api/calendars', { method: 'POST', body: JSON.stringify({ name: '   ' }) })
      expect(res.status).toBe(422)
    })
  })

  describe('row-level rules', () => {
    it("keeps one user out of another's local calendar", async () => {
      const { calendar } = await setup('lc-q')
      const { user: other } = await setup('lc-r')

      const viaApi = await other.api('/api/events', { method: 'POST', body: eventBody(calendar.id) })
      expect(viaApi.status).toBe(404)

      const direct = await other.client.from('events').insert({
        user_id: other.id,
        calendar_id: calendar.id,
        title: 'x',
        start_time: WEEK.start,
        end_time: WEEK.start,
        timezone: 'UTC',
      })
      expect(direct.error?.code).toBe('23503')

      expect((await other.api(`/api/calendars/${calendar.id}`, { method: 'DELETE' })).status).toBe(404)
      const { data } = await other.client.from('calendars').select('id').eq('id', calendar.id)
      expect(data).toEqual([])
    })

    it('rejects a calendar row with a mismatched shape', async () => {
      const { user } = await setup('lc-s')
      const { error } = await user.client.from('calendars').insert({
        user_id: user.id,
        source: 'local',
        google_calendar_id: 'primary',
        name: 'x',
        color: '#000000',
      })
      expect(error?.code).toBe('23514')
    })

    it('gives two people with the same email name separate usernames', async () => {
      const shared = `dup${Date.now().toString(36)}`
      const client = (await import('./helpers')).publicClient()
      const first = await client.auth.signUp({ email: `${shared}@one.example.com`, password: 'correct-horse-battery-1' })
      expect(first.error).toBeNull()
      const second = await client.auth.signUp({ email: `${shared}@two.example.com`, password: 'correct-horse-battery-1' })
      expect(second.error).toBeNull()
      const { data } = await serviceClient()
        .from('profiles')
        .select('username')
        .in('id', [first.data.user!.id, second.data.user!.id])
      expect(new Set(data!.map((p) => p.username)).size).toBe(2)
    })
  })

  it('still works in a browser session', async () => {
    const { user, calendar } = await setup('lc-t')
    const res = await browserApi(user, '/api/events', { method: 'POST', body: eventBody(calendar.id) })
    expect(res.status).toBe(201)
  })
})
