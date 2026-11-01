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
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    return Promise.resolve(result).then(resolve, reject)
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
