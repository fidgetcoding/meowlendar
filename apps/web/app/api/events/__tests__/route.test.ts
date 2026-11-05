vi.mock('@/lib/google/sync', () => ({ pushEvent: vi.fn(async (event: unknown) => event) }))
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET, POST } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
  validationError: vi.fn((issues: { path: (string | number)[]; message: string }[]) => {
    const details: Record<string, string[]> = {}
    for (const issue of issues) {
      const key = issue.path.join('.') || '_root'
      if (!details[key]) details[key] = []
      details[key]!.push(issue.message)
    }
    return NextResponse.json({ error: 'Validation error', details }, { status: 422 })
  }),
}))

vi.mock('@/lib/google/calendar', () => ({
  createGoogleEvent: vi.fn().mockResolvedValue({
    id: 'google-evt-1',
    etag: '"etag-1"',
    hangoutLink: null,
  }),
}))

import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'
import { omit } from '@/lib/omit'

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_CALENDAR_ID = '00000000-0000-4000-8000-000000000002'

function createRequest(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    ...(body ? {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    } : {}),
  })
}

/**
 * Creates a chainable Supabase query mock.
 * Every method returns `this` (the same builder), and the builder is a thenable
 * that resolves to `result`. Calling `.single()` also returns a promise resolving
 * to `result`.
 */
function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}

  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'containedBy',
    'order', 'limit', 'range', 'filter',
    'not', 'or', 'match',
  ]

  for (const m of methods) {
    builder[m] = vi.fn().mockReturnValue(builder)
  }

  // Terminal methods resolve to the result
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)

  // Make the builder itself thenable so bare `await query` works
  let offset = 0
  let end: number | undefined
  builder.range = vi.fn((from: number, to: number) => { offset = from; end = to + 1; return builder })
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    return Promise.resolve({ ...result, data: Array.isArray(result.data) ? result.data.slice(offset, end) : result.data }).then(resolve, reject)
  }

  return builder
}

function mockAuthWithTables(
  tableResults: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>
) {
  const callCounts: Record<string, number> = {}
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (!callCounts[table]) callCounts[table] = 0
      const entry = tableResults[table]
      let result: { data: unknown; error: unknown }
      if (Array.isArray(entry)) {
        result = entry[callCounts[table]!] ?? entry[entry.length - 1]!
      } else {
        result = entry ?? { data: null, error: null }
      }
      callCounts[table]!++
      return makeQueryBuilder(result)
    }),
  }
  vi.mocked(authenticate).mockResolvedValue({ userId: TEST_USER_ID, supabase: supabase as unknown as AuthResult['supabase'] })
  return supabase
}

function mockAuthUnauthorized() {
  vi.mocked(authenticate).mockResolvedValue(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  )
}

function validEventBody() {
  return {
    calendar_id: TEST_CALENDAR_ID,
    title: 'Team standup',
    start_time: '2026-06-15T09:00:00Z',
    end_time: '2026-06-15T09:30:00Z',
    timezone: 'America/New_York',
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pages through distinct occurrences of the same recurring event', async () => {
    mockAuthWithTables({
      events: { data: [{ id: 'series', start_time: '2026-06-15T09:00:00Z', end_time: '2026-06-15T10:00:00Z', timezone: 'UTC', recurrence_rule: 'FREQ=DAILY;COUNT=3' }], error: null },
      calendars: { data: [], error: null },
    })
    const starts: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 4; page++) {
      const params = new URLSearchParams({ start: '2026-06-15T00:00:00Z', end: '2026-06-18T00:00:00Z', include: 'events', limit: '1' })
      if (cursor) params.set('cursor', cursor)
      const response = await GET(createRequest('GET', `/api/events?${params}`))
      const body = await response.json()
      starts.push(...body.items.map((item: { start_time: string }) => item.start_time))
      cursor = body.next_cursor
      if (!cursor) break
    }
    expect(starts).toEqual(['2026-06-15T09:00:00.000Z', '2026-06-16T09:00:00.000Z', '2026-06-17T09:00:00.000Z'])
    expect(cursor).toBeNull()
  })

  it('returns events list with correct query params', async () => {
    const events = [
      { id: 'e1', title: 'Meeting', start_time: '2026-06-15T09:00:00Z' },
      { id: 'e2', title: 'Lunch', start_time: '2026-06-15T12:00:00Z' },
    ]
    mockAuthWithTables({ events: { data: events, error: null } })

    const req = createRequest('GET', '/api/events?start=2026-06-15T00:00:00Z&end=2026-06-15T23:59:59Z')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].title).toBe('Meeting')
    expect(body.next_cursor).toBeNull()
  })

  it('returns events filtered by calendar_id', async () => {
    const events = [{ id: 'e1', title: 'Filtered', calendar_id: TEST_CALENDAR_ID }]
    mockAuthWithTables({ events: { data: events, error: null } })

    const req = createRequest(
      'GET',
      `/api/events?start=2026-06-15T00:00:00Z&end=2026-06-15T23:59:59Z&calendar_id=${TEST_CALENDAR_ID}`
    )
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].calendar_id).toBe(TEST_CALENDAR_ID)
  })

  it('returns empty array when no events match', async () => {
    mockAuthWithTables({ events: { data: [], error: null } })

    const req = createRequest('GET', '/api/events?start=2026-06-15T00:00:00Z&end=2026-06-15T23:59:59Z')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.next_cursor).toBeNull()
  })

  it('returns 400 when start/end query params are missing', async () => {
    mockAuthWithTables({})

    const req = createRequest('GET', '/api/events')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Missing required query parameters')
  })

  it('returns 500 when supabase query fails', async () => {
    mockAuthWithTables({ events: { data: null, error: { message: 'DB error' } } })

    const req = createRequest('GET', '/api/events?start=2026-06-15T00:00:00Z&end=2026-06-15T23:59:59Z')
    const res = await GET(req)

    expect(res.status).toBe(500)
  })
})

describe('GET /api/events with one meeting on two accounts', () => {
  beforeEach(() => vi.clearAllMocks())

  const copy = (id: string, calendarId: string, extra: Record<string, unknown> = {}) => ({
    id, calendar_id: calendarId, google_event_id: 'kickoff', ical_uid: 'kickoff@google.com', title: 'Kickoff',
    start_time: '2026-06-15T09:00:00+00:00', end_time: '2026-06-15T10:00:00+00:00', timezone: 'UTC', recurrence_rule: null, attendees: [], ...extra,
  })
  const answer = (email: string, response_status: string) => [{ email, response_status, self: true }]
  const calendars = [
    { id: 'cal-work', source: 'google', access_role: 'owner', is_primary: true, google_account_id: 'acct-work' },
    { id: 'cal-home', source: 'google', access_role: 'owner', is_primary: true, google_account_id: 'acct-home' },
  ]
  const accounts = [{ id: 'acct-work', email: 'nate@work.test' }, { id: 'acct-home', email: 'nate@home.test' }]
  const list = (query = '') => GET(createRequest('GET', `/api/events?start=2026-06-15T00:00:00Z&end=2026-06-16T00:00:00Z&include=events${query}`))

  it('returns it once, the copy you accepted, with the other copy in also_on', async () => {
    mockAuthWithTables({
      events: { data: [copy('home-copy', 'cal-home', { attendees: answer('nate@home.test', 'needsAction') }), copy('work-copy', 'cal-work', { attendees: answer('nate@work.test', 'accepted') })], error: null },
      calendars: [{ data: [], error: null }, { data: calendars, error: null }],
      google_accounts: { data: accounts, error: null },
    })
    const body = await (await list()).json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('work-copy')
    expect(body.items[0].also_on).toEqual([
      { event_id: 'home-copy', calendar_id: 'cal-home', account_email: 'nate@home.test', google_event_id: 'kickoff', response_status: 'needsAction' },
    ])
  })

  it('keeps each day of a series, and returns every row with merge=false', async () => {
    const series = { recurrence_rule: 'FREQ=DAILY;COUNT=3', start_time: '2026-06-15T09:00:00Z', end_time: '2026-06-15T10:00:00Z' }
    mockAuthWithTables({
      events: { data: [copy('a', 'cal-work', series), copy('b', 'cal-home', series)], error: null },
      calendars: [{ data: [], error: null }, { data: calendars, error: null }],
      google_accounts: { data: accounts, error: null },
    })
    const merged = await (await GET(createRequest('GET', '/api/events?start=2026-06-15T00:00:00Z&end=2026-06-18T00:00:00Z&include=events'))).json()
    expect(merged.items.map((i: { id: string; start_time: string }) => [i.id, i.start_time])).toEqual([
      ['a', '2026-06-15T09:00:00.000Z'], ['a', '2026-06-16T09:00:00.000Z'], ['a', '2026-06-17T09:00:00.000Z'],
    ])

    mockAuthWithTables({
      events: { data: [copy('a', 'cal-work'), copy('b', 'cal-home')], error: null },
      calendars: { data: [], error: null },
    })
    const raw = await (await list('&merge=false')).json()
    expect(raw.items.map((i: { id: string }) => i.id).sort()).toEqual(['a', 'b'])
    expect(raw.items.every((i: { also_on?: unknown }) => i.also_on === undefined)).toBe(true)
  })
})

describe('POST /api/events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates event with valid body and returns 201', async () => {
    const createdEvent = { id: 'e-new', ...validEventBody(), status: 'confirmed' }
    const calendarRow = {
      id: TEST_CALENDAR_ID,
      google_account_id: 'ga-1',
      google_calendar_id: 'gc-1',
    }

    mockAuthWithTables({
      calendars: { data: calendarRow, error: null },
      events: [
        { data: createdEvent, error: null },                          // insert
        { data: { ...createdEvent, google_event_id: 'google-evt-1' }, error: null }, // update with google IDs
      ],
    })

    const req = createRequest('POST', '/api/events', validEventBody())
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.id).toBeDefined()
  })

  it('rejects request with missing title as 422 validation error', async () => {
    mockAuthWithTables({})

    const noTitle = omit(validEventBody(), ['title'])
    const req = createRequest('POST', '/api/events', noTitle)
    const res = await POST(req)

    expect(res.status).toBe(422)
  })

  it('rejects unauthenticated request with 401', async () => {
    mockAuthUnauthorized()

    const req = createRequest('POST', '/api/events', validEventBody())
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('rejects invalid JSON body with 400', async () => {
    mockAuthWithTables({})

    const req = new NextRequest(new URL('/api/events', 'http://localhost:3000'), {
      method: 'POST',
      body: 'not-json{{{',
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 404 when calendar does not belong to user', async () => {
    mockAuthWithTables({
      calendars: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest('POST', '/api/events', validEventBody())
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain('Calendar not found')
  })
})

// The page resends a just-made event while it unloads, under the id it chose. One event, not two.
describe('POST /api/events with the id the page chose', () => {
  beforeEach(() => vi.clearAllMocks())
  const CLIENT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
  const localCalendar = { id: TEST_CALENDAR_ID, source: 'local', google_account_id: null, google_calendar_id: null }

  it('creates the event under that id', async () => {
    const supabase = mockAuthWithTables({
      calendars: { data: localCalendar, error: null },
      events: [
        { data: null, error: null }, // not there yet
        { data: { id: CLIENT_ID, ...validEventBody() }, error: null }, // insert
      ],
    })
    const res = await POST(createRequest('POST', '/api/events', { ...validEventBody(), id: CLIENT_ID }))
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe(CLIENT_ID)
    const insert = supabase.from.mock.results[2]!.value.insert as ReturnType<typeof vi.fn>
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: CLIENT_ID }))
  })

  it('answers with the existing event when that id is already there, and inserts nothing', async () => {
    const existing = { id: CLIENT_ID, ...validEventBody() }
    const supabase = mockAuthWithTables({
      calendars: { data: localCalendar, error: null },
      events: { data: existing, error: null },
    })
    const res = await POST(createRequest('POST', '/api/events', { ...validEventBody(), id: CLIENT_ID }))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(CLIENT_ID)
    const eventsCalls = supabase.from.mock.calls.filter(([t]) => t === 'events')
    expect(eventsCalls).toHaveLength(1)
    expect(supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i]![0] === 'events')!.value.insert).not.toHaveBeenCalled()
  })

  it('a create that lost the race to its resend answers with the winner', async () => {
    const existing = { id: CLIENT_ID, ...validEventBody() }
    mockAuthWithTables({
      calendars: { data: localCalendar, error: null },
      events: [
        { data: null, error: null },
        { data: null, error: { code: '23505', message: 'duplicate key' } },
        { data: existing, error: null },
      ],
    })
    const res = await POST(createRequest('POST', '/api/events', { ...validEventBody(), id: CLIENT_ID }))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(CLIENT_ID)
  })

  it('ignores an id that is not a UUID', async () => {
    const supabase = mockAuthWithTables({
      calendars: { data: localCalendar, error: null },
      events: { data: { id: 'e-new', ...validEventBody() }, error: null },
    })
    await POST(createRequest('POST', '/api/events', { ...validEventBody(), id: 'not-a-uuid' }))
    const insert = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i]![0] === 'events')!.value.insert as ReturnType<typeof vi.fn>
    expect(insert.mock.calls[0]![0]).not.toHaveProperty('id')
  })
})

describe('POST /api/events busy or free', () => {
  beforeEach(() => vi.clearAllMocks())
  const localCalendar = { id: TEST_CALENDAR_ID, source: 'local', google_account_id: null, google_calendar_id: null }
  const insertedWith = async (extra: Record<string, unknown>) => {
    const supabase = mockAuthWithTables({ calendars: { data: localCalendar, error: null }, events: { data: { id: 'e1' }, error: null } })
    await POST(createRequest('POST', '/api/events', { ...validEventBody(), ...extra }))
    const i = supabase.from.mock.calls.findIndex(([t]) => t === 'events')
    return (supabase.from.mock.results[i]!.value.insert as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
  }

  it('shows a new all-day event as free unless told otherwise, as Google does', async () => {
    expect((await insertedWith({ is_all_day: true })).visibility).toBe('free')
    expect((await insertedWith({ is_all_day: true, visibility: 'busy' })).visibility).toBe('busy')
  })

  it('keeps timed events busy by default', async () => {
    expect((await insertedWith({ is_all_day: false })).visibility).toBe('busy')
    expect((await insertedWith({ visibility: 'free' })).visibility).toBe('free')
  })
})
