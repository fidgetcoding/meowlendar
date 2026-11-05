import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach } from 'vitest'
import { APP, browserApi, connectGoogle, createUser, cron, fakes, serviceClient, type TestUser } from './helpers'

// One person with several Google accounts, against the local fake Google. The fake
// hands out iCalUIDs and lists cancelled occurrences the way Google documents. It is
// still not Google: this shows the app's half works, not that Google agrees.
// The grid merges copies of one meeting by iCalUID; grid-helpers.test.ts covers that.

const WEEK = { start: '2030-01-07T00:00:00.000Z', end: '2030-01-13T23:59:59.000Z' }

interface Account {
  id: string
  email: string
  calendars: { id: string; name: string; google_calendar_id: string; is_active: boolean }[]
}
interface Item {
  id: string
  kind: string
  title: string
  start_time: string
  calendar_id: string
  ical_uid?: string | null
  also_on?: { event_id: string; calendar_id: string; account_email: string | null; google_event_id: string; response_status: string | null }[]
}
interface Row {
  id: string
  calendar_id: string
  google_event_id: string
  ical_uid: string | null
  title: string
  attendees: { email: string; response_status: string; self?: boolean }[]
}

let n = 0
const newEmail = () => `multi${Date.now().toString(36)}${++n}@gmail.test`
const at = (day: string, hour = 10) => `2030-01-${day}T${String(hour).padStart(2, '0')}:00:00Z`
const iso = (value: string) => new Date(value).toISOString()

function meeting(id: string, summary: string, day = '08', extra: Record<string, unknown> = {}) {
  return { id, summary, start: { dateTime: at(day), timeZone: 'UTC' }, end: { dateTime: at(day, 11), timeZone: 'UTC' }, ...extra }
}

const put = (email: string, calendarId: string, event: Record<string, unknown>) =>
  fakes('google/put-event', { email, calendarId, event })

async function accounts(user: TestUser): Promise<Account[]> {
  return ((await (await user.api('/api/calendars')).json()) as { accounts: Account[] }).accounts
}

async function shown(user: TestUser, include = 'events', merge = true): Promise<Item[]> {
  const res = await user.api(`/api/events?start=${WEEK.start}&end=${WEEK.end}&include=${include}${merge ? '' : '&merge=false'}`)
  return ((await res.json()) as { items: Item[] }).items
}

async function rows(user: TestUser): Promise<Row[]> {
  const { data, error } = await serviceClient()
    .from('events')
    .select('id, calendar_id, google_event_id, ical_uid, title, attendees')
    .eq('user_id', user.id)
  expect(error).toBeNull()
  return (data ?? []) as Row[]
}

function expectOneRowPerGoogleEvent(list: Row[]) {
  const keys = list.map((r) => `${r.calendar_id}|${r.google_event_id}`)
  expect(new Set(keys).size).toBe(keys.length)
}

/** Resync, as the button does. Explicit accounts skip the open-tab throttle. */
async function pull(user: TestUser, accountId: string) {
  return user.api('/api/google/sync', { method: 'POST', body: JSON.stringify({ google_account_id: accountId }) })
}

async function pullAll(user: TestUser) {
  for (const account of await accounts(user)) expect((await pull(user, account.id)).status).toBe(200)
}

/** A push notification from Google for the account's watched calendar. */
async function webhook(accountId: string) {
  const env = JSON.parse(readFileSync(process.env.MEOW_APP_ENV_FILE as string, 'utf8')) as Record<string, string>
  const channel = `chan-${accountId}`
  await serviceClient().from('google_accounts').update({ webhook_channel_id: channel, webhook_resource_id: 'res' }).eq('id', accountId)
  return fetch(`${APP}/api/google/webhook`, {
    method: 'POST',
    headers: {
      'x-goog-channel-id': channel,
      'x-goog-resource-id': 'res',
      'x-goog-resource-state': 'exists',
      'x-goog-channel-token': env.GOOGLE_WEBHOOK_SECRET!,
    },
  })
}

async function connectAll(prefix: string, ...emails: string[]) {
  const user = await createUser(prefix)
  for (const email of emails) expect(await connectGoogle(user, email)).toContain('google_connected=true')
  return user
}

describe('several Google accounts on one person, against a fake server', () => {
  beforeEach(() => fakes('reset'))

  it('lists every calendar of every account with its own switch, and brings each event in once', async () => {
    const [a, b, c] = [newEmail(), newEmail(), newEmail()]
    await fakes('google/add-account', { email: a, calendars: [{ id: a, summary: 'A main', primary: true }, { id: 'a-work@group.test', summary: 'A work' }] })
    await fakes('google/add-account', { email: b, calendars: [{ id: b, summary: 'B main', primary: true }, { id: 'b-family@group.test', summary: 'B family', accessRole: 'reader' }] })
    await fakes('google/add-account', { email: c, calendars: [{ id: c, summary: 'C main', primary: true }] })
    await put(a, a, meeting('a1', 'A1'))
    await put(a, 'a-work@group.test', meeting('a2', 'A2'))
    await put(b, b, meeting('b1', 'B1'))
    await put(b, 'b-family@group.test', meeting('b2', 'B2'))
    await put(c, c, meeting('c1', 'C1'))

    const user = await connectAll('ma-a', a, b, c)
    const accts = await accounts(user)
    const names = (email: string) => accts.find((x) => x.email === email)!.calendars.map((cal) => cal.name).sort()
    expect(accts.map((x) => x.email).sort()).toEqual([a, b, c].sort())
    expect(names(a)).toEqual(['A main', 'A work'])
    expect(names(b)).toEqual(['B family', 'B main'])
    expect(names(c)).toEqual(['C main'])
    expect(accts.flatMap((x) => x.calendars).every((cal) => cal.is_active)).toBe(true)
    expect((await shown(user)).map((i) => i.title).sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])

    // One account's calendar off leaves every other calendar alone.
    const family = accts.flatMap((x) => x.calendars).find((cal) => cal.name === 'B family')!
    expect((await user.api(`/api/calendars/${family.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) })).status).toBe(200)
    await pullAll(user)
    expect((await shown(user)).map((i) => i.title).sort()).toEqual(['A1', 'A2', 'B1', 'C1'])
    expectOneRowPerGoogleEvent(await rows(user))
  })

  it('keeps one row per copy of a meeting invited to two accounts, tied by iCalUID, through repeated and racing syncs', async () => {
    const [a, b] = [newEmail(), newEmail()]
    await fakes('google/add-account', { email: a })
    await fakes('google/add-account', { email: b })
    const guests = (self: string) => [a, b].map((email) => ({ email, responseStatus: email === a ? 'accepted' : 'needsAction', ...(email === self ? { self: true } : {}) }))
    // Between Google accounts, both copies share the event id and the iCalUID.
    await put(a, a, meeting('kickoff', 'Kickoff', '08', { attendees: guests(a) }))
    await put(b, b, meeting('kickoff', 'Kickoff', '08', { attendees: guests(b) }))
    // An invite from another calendar system gets its own id in each account.
    await put(a, a, meeting('vendora1', 'Vendor call', '09', { iCalUID: 'vendor-123@outlook.test' }))
    await put(b, b, meeting('vendorb1', 'Vendor call', '09', { iCalUID: 'vendor-123@outlook.test' }))

    const user = await connectAll('ma-b', a, b)
    const [first, second] = await accounts(user)
    for (let i = 0; i < 2; i++) {
      await pullAll(user)
      expect((await webhook(first!.id)).status).toBe(200)
    }
    // Everything at once: two webhooks, the scheduled poll and both Resync buttons.
    // Both accounts look stale, so the poll pulls them too. It also pulls every other
    // stale account the suite has left behind, which is why this test gets longer.
    await serviceClient().from('google_accounts').update({ last_synced_at: null }).eq('user_id', user.id)
    const raced = await Promise.all([webhook(first!.id), webhook(second!.id), webhook(first!.id), cron('sync-poll'), pull(user, first!.id), pull(user, second!.id)])
    expect(raced.map((r) => r.status).every((status) => status === 200 || status === 409)).toBe(true)
    await put(a, a, { id: 'kickoff', summary: 'Kickoff (moved room)' })
    await Promise.all([webhook(first!.id), webhook(first!.id), pull(user, first!.id)])
    await pullAll(user)

    const list = await rows(user)
    expectOneRowPerGoogleEvent(list)
    expect(list).toHaveLength(4)
    const copies = (uid: string) => list.filter((r) => r.ical_uid === uid)
    expect(new Set(copies('kickoff@google.com').map((r) => r.calendar_id)).size).toBe(2)
    expect(new Set(copies('vendor-123@outlook.test').map((r) => r.calendar_id)).size).toBe(2)
    // Each copy knows which guest is the account it came from.
    const own = (row: Row) => row.attendees.find((x) => x.self)?.email
    expect(copies('kickoff@google.com').map(own).sort()).toEqual([a, b].sort())

    // Every row, with the identity the grid merges on.
    const raw = await shown(user, 'events', false)
    expect(raw.map((i) => i.ical_uid).sort()).toEqual(['kickoff@google.com', 'kickoff@google.com', 'vendor-123@outlook.test', 'vendor-123@outlook.test'])
    expect(raw.filter((i) => i.ical_uid === 'kickoff@google.com').map((i) => i.title).sort()).toEqual(['Kickoff', 'Kickoff (moved room)'])
    expect(raw.every((i) => i.also_on === undefined)).toBe(true)

    // By default each meeting once, as on the grid. The copy shown is the one accepted.
    const merged = await shown(user)
    expect(merged.map((i) => i.ical_uid)).toEqual(['kickoff@google.com', 'vendor-123@outlook.test'])
    const kickoff = merged[0]!
    expect(list.find((r) => r.id === kickoff.id)!.attendees.find((x) => x.self)?.email).toBe(a)
    expect(kickoff.also_on).toEqual([{
      event_id: copies('kickoff@google.com').find((r) => r.id !== kickoff.id)!.id,
      calendar_id: copies('kickoff@google.com').find((r) => r.id !== kickoff.id)!.calendar_id,
      account_email: b,
      google_event_id: 'kickoff',
      response_status: 'needsAction',
    }])
    expect(merged[1]!.also_on).toHaveLength(1)
  }, 120_000)

  it('brings a calendar shared with two accounts in under each, with the same identity for its events', async () => {
    const [a, b] = [newEmail(), newEmail()]
    const team = { id: 'team@group.test', summary: 'Team' }
    await fakes('google/add-account', { email: a, calendars: [{ id: a, summary: 'A', primary: true }, team] })
    await fakes('google/add-account', { email: b, calendars: [{ id: b, summary: 'B', primary: true }, { ...team, accessRole: 'reader' }] })
    await put(a, team.id, meeting('standup', 'Standup', '10'))
    await put(b, team.id, meeting('standup', 'Standup', '10'))

    const user = await connectAll('ma-c', a, b)
    await pullAll(user)
    const teams = (await accounts(user)).flatMap((x) => x.calendars).filter((cal) => cal.name === 'Team')
    expect(teams).toHaveLength(2)
    const list = await rows(user)
    expectOneRowPerGoogleEvent(list)
    expect(list.map((r) => [r.google_event_id, r.ical_uid])).toEqual([['standup', 'standup@google.com'], ['standup', 'standup@google.com']])
  })

  it('merges a second connect of the same account into the first', async () => {
    const a = newEmail()
    await fakes('google/add-account', { email: a, calendars: [{ id: a, summary: 'Main', primary: true }, { id: 'side@group.test', summary: 'Side' }] })
    await put(a, a, meeting('once', 'Once'))
    const user = await connectAll('ma-d', a, a)
    await pullAll(user)
    const accts = await accounts(user)
    expect(accts).toHaveLength(1)
    expect(accts[0]!.calendars).toHaveLength(2)
    expect((await rows(user)).map((r) => r.title)).toEqual(['Once'])
  })

  it('refuses a second row for one Google event on one calendar', async () => {
    const a = newEmail()
    await fakes('google/add-account', { email: a })
    await put(a, a, meeting('solo', 'Solo'))
    const user = await connectAll('ma-e', a)
    const [row] = await rows(user)
    const { error } = await serviceClient().from('events').insert({
      user_id: user.id,
      calendar_id: row!.calendar_id,
      google_event_id: 'solo',
      title: 'Solo again',
      start_time: at('08'),
      end_time: at('08', 11),
      timezone: 'UTC',
    })
    expect(error?.code).toBe('23505')
  })

  describe('recurring events', () => {
    const series = (extra: Record<string, unknown> = {}) =>
      meeting('daily', 'Daily', '07', { recurrence: ['RRULE:FREQ=DAILY;COUNT=7'], ...extra })
    const moved = {
      id: 'daily_20300109T100000Z',
      recurringEventId: 'daily',
      originalStartTime: { dateTime: at('09') },
      summary: 'Daily',
      start: { dateTime: at('09', 15), timeZone: 'UTC' },
      end: { dateTime: at('09', 16), timeZone: 'UTC' },
    }
    const startsOn = (items: Item[], day: string) => items.map((i) => iso(i.start_time)).filter((s) => s.startsWith(`2030-01-${day}`))

    /** A series with one occurrence moved, where Google lists the move before the series. */
    async function movedFirst(prefix: string) {
      const a = newEmail()
      await fakes('google/add-account', { email: a })
      await put(a, a, moved)
      await put(a, a, series())
      const user = await connectAll(prefix, a)
      return { a, user, accountId: (await accounts(user))[0]!.id }
    }

    it('moves an occurrence once, even when Google lists it before its series', async () => {
      const { a, user, accountId } = await movedFirst('ma-f')
      const items = await shown(user)
      expect(items).toHaveLength(7)
      expect(startsOn(items, '09')).toEqual(['2030-01-09T15:00:00.000Z'])

      // Repeated pulls, a webhook and an expired sync token add nothing.
      for (let i = 0; i < 2; i++) expect((await pull(user, accountId)).status).toBe(200)
      expect((await webhook(accountId)).status).toBe(200)
      await fakes('google/expire-sync-tokens', { email: a, calendarId: a })
      expect((await pull(user, accountId)).status).toBe(200)
      expect(await shown(user)).toHaveLength(7)
      expect(await rows(user)).toHaveLength(2)
    })

    it('keeps a moved occurrence moved when the series changes on Google', async () => {
      const a = newEmail()
      await fakes('google/add-account', { email: a })
      await put(a, a, series())
      const user = await connectAll('ma-g', a)
      const accountId = (await accounts(user))[0]!.id
      await put(a, a, moved)
      expect((await pull(user, accountId)).status).toBe(200)
      expect(await shown(user)).toHaveLength(7)
      await put(a, a, { id: 'daily', summary: 'Daily standup' })
      expect((await pull(user, accountId)).status).toBe(200)
      const items = await shown(user)
      expect(items).toHaveLength(7)
      expect(startsOn(items, '09')).toEqual(['2030-01-09T15:00:00.000Z'])
    })

    it('moves only the occurrence moved later on Google', async () => {
      const a = newEmail()
      await fakes('google/add-account', { email: a })
      await put(a, a, series())
      const user = await connectAll('ma-h', a)
      await put(a, a, { ...moved, id: 'daily_20300110T100000Z', originalStartTime: { dateTime: at('10') }, start: { dateTime: at('10', 13), timeZone: 'UTC' }, end: { dateTime: at('10', 14), timeZone: 'UTC' } })
      await pullAll(user)
      const items = await shown(user)
      expect(items).toHaveLength(7)
      expect(startsOn(items, '10')).toEqual(['2030-01-10T13:00:00.000Z'])
      expect(startsOn(items, '11')).toEqual(['2030-01-11T10:00:00.000Z'])
    })

    it('leaves out an occurrence deleted on Google before the first sync, and after a full resync', async () => {
      const a = newEmail()
      await fakes('google/add-account', { email: a })
      await put(a, a, series())
      await put(a, a, { id: 'daily_20300110T100000Z', recurringEventId: 'daily', originalStartTime: { dateTime: at('10') }, status: 'cancelled' })
      const user = await connectAll('ma-i', a)
      expect(startsOn(await shown(user), '10')).toEqual([])
      expect(await shown(user)).toHaveLength(6)

      await fakes('google/expire-sync-tokens', { email: a, calendarId: a })
      await pullAll(user)
      expect(await shown(user)).toHaveLength(6)
    })

    it('removes the whole series, moved occurrences too, when it is deleted on Google', async () => {
      const { a, user, accountId } = await movedFirst('ma-j')
      await fakes('google/cancel-event', { email: a, calendarId: a, id: 'daily' })
      expect((await pull(user, accountId)).status).toBe(200)
      expect(await shown(user)).toEqual([])
      expect(await rows(user)).toEqual([])
    })
  })

  it('never shows a task next to its Google copy, also when a second account shares that calendar', async () => {
    const [a, b] = [newEmail(), newEmail()]
    const team = { id: 'team@group.test', summary: 'Team' }
    await fakes('google/add-account', { email: a, calendars: [{ id: a, summary: 'A', primary: true }, team] })
    await fakes('google/add-account', { email: b, calendars: [{ id: b, summary: 'B', primary: true }, { ...team, accessRole: 'writer' }] })
    const user = await connectAll('ma-k', a, b)
    const accts = await accounts(user)
    const target = accts.find((x) => x.email === a)!.calendars.find((cal) => cal.name === 'Team')!
    expect((await user.api('/api/tasks/google-sync', { method: 'PUT', body: JSON.stringify({ calendar_id: target.id }) })).status).toBe(200)
    const created = await user.api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Write report', scheduled_start: at('08'), scheduled_end: at('08', 11) }),
    })
    expect(created.status).toBe(201)
    expect((await user.api('/api/google/sync', { method: 'POST' })).status).toBe(200)
    const { items: [mirror] } = await fakes<{ items: Record<string, unknown>[] }>('google/list-events', { email: a, calendarId: team.id })
    expect(mirror).toBeTruthy()

    // The other account sees the same event on the shared calendar: in case Google
    // withholds the private property from it, without, and then with.
    const bare = { ...mirror! }
    delete bare.extendedProperties
    await put(b, team.id, bare)
    await pullAll(user)
    expect(await rows(user)).toEqual([])
    await put(b, team.id, mirror!)
    await pullAll(user)
    expect(await rows(user)).toEqual([])
    expect((await shown(user, 'events,tasks')).map((i) => [i.kind, i.title])).toEqual([['task', 'Write report']])
  })

  it('sends a reply to Google as the account of the copy answered, and says so when Google refuses', async () => {
    const [a, b] = [newEmail(), newEmail()]
    const team = { id: 'team@group.test', summary: 'Team' }
    await fakes('google/add-account', { email: a })
    await fakes('google/add-account', { email: b, calendars: [{ id: b, summary: 'B', primary: true }, team] })
    const guests = (self: string) => ['organizer@acme.test', a, b].map((email) => ({ email, responseStatus: 'needsAction', ...(email === self ? { self: true } : {}) }))
    await put(a, a, meeting('kickoff', 'Kickoff', '08', { attendees: guests(a) }))
    await put(b, b, meeting('kickoff', 'Kickoff', '08', { attendees: guests(b) }))
    await put(b, team.id, meeting('teamonly', 'Team only', '09', { attendees: [{ email: 'organizer@acme.test', responseStatus: 'accepted' }] }))
    const user = await connectAll('ma-m', a, b)
    const accts = await accounts(user)
    const onCalendar = (email: string, calendarId: string) => accts.find((x) => x.email === email)!.calendars.find((c) => c.google_calendar_id === calendarId)!.id
    const list = await rows(user)
    const copyOn = (calendarId: string) => list.find((r) => r.calendar_id === calendarId)!
    const rsvp = (row: Row, response: string) => user.api(`/api/events/${row.id}/rsvp`, { method: 'POST', body: JSON.stringify({ response }) })
    const answerOf = async (email: string, calendarId: string, guest: string) =>
      (await fakes<{ items: { id: string; attendees?: { email: string; responseStatus: string }[] }[] }>('google/list-events', { email, calendarId }))
        .items[0]!.attendees!.find((x) => x.email === guest)!.responseStatus

    // Declining from B leaves A's copy, and A's answer, alone.
    const fromB = copyOn(onCalendar(b, b))
    expect((await rsvp(fromB, 'declined')).status).toBe(200)
    expect(await answerOf(b, b, b)).toBe('declined')
    expect(await answerOf(a, a, a)).toBe('needsAction')
    await pullAll(user)
    const mine = (row?: Row) => row!.attendees.find((x) => x.self)
    expect(mine((await rows(user)).find((r) => r.id === fromB.id))).toMatchObject({ email: b, response_status: 'declined' })

    const fromA = copyOn(onCalendar(a, a))
    expect((await rsvp(fromA, 'tentative')).status).toBe(200)
    expect(await answerOf(a, a, a)).toBe('tentative')

    // Google refusing is an error, and nothing changes here.
    await fakes('google/fail-next', { key: 'PATCH /events/', status: 500 })
    const refused = await rsvp(fromA, 'accepted')
    expect(refused.status).toBe(502)
    expect(((await refused.json()) as { error: string }).error).toMatch(/Google/)
    expect(mine((await rows(user)).find((r) => r.id === fromA.id))?.response_status).toBe('tentative')

    // A calendar where neither account is a guest has no reply to send.
    expect((await rsvp(copyOn(onCalendar(b, team.id)), 'accepted')).status).toBe(422)
  })

  it('disconnecting one account takes its calendars and events, and leaves the other account whole', async () => {
    const [a, b] = [newEmail(), newEmail()]
    await fakes('google/add-account', { email: a })
    await fakes('google/add-account', { email: b })
    await put(a, a, meeting('kickoff', 'Kickoff'))
    await put(b, b, meeting('kickoff', 'Kickoff'))
    await put(a, a, meeting('onlya', 'Only on A', '09'))
    const user = await connectAll('ma-l', a, b)
    const gone = (await accounts(user)).find((x) => x.email === a)!

    expect((await browserApi(user, `/api/google/disconnect/${gone.id}`, { method: 'DELETE' })).status).toBe(200)
    const left = await accounts(user)
    expect(left.map((x) => x.email)).toEqual([b])
    await pullAll(user)
    const list = await rows(user)
    expect(list.map((r) => [r.title, r.calendar_id])).toEqual([['Kickoff', left[0]!.calendars[0]!.id]])
    const db = serviceClient()
    expect((await db.from('calendars').select('id').eq('google_account_id', gone.id)).data).toEqual([])
    expect((await db.from('account_sync_locks').select('account_id').eq('account_id', gone.id)).data).toEqual([])
  })
})
