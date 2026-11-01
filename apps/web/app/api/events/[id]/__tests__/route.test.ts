import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET, PATCH, DELETE } from '../route'

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
  updateGoogleEvent: vi.fn().mockResolvedValue({ etag: '"etag-2"' }),
  deleteGoogleEvent: vi.fn().mockResolvedValue(undefined),
}))

import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_EVENT_ID = '00000000-0000-4000-8000-000000000010'

function createRequest(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    ...(body ? {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    } : {}),
  })
}

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'containedBy',
    'order', 'limit', 'range', 'filter', 'not', 'or', 'match',
  ]
  for (const m of methods) {
    builder[m] = vi.fn().mockReturnValue(builder)
  }
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    return Promise.resolve(result).then(resolve, reject)
  }
  return builder
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) }
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/events/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a single event by ID', async () => {
    const event = {
      id: TEST_EVENT_ID,
      title: 'Standup',
      user_id: TEST_USER_ID,
      start_time: '2026-06-15T09:00:00Z',
    }
    mockAuthWithTables({ events: { data: event, error: null } })

    const req = createRequest('GET', `/api/events/${TEST_EVENT_ID}`)
    const res = await GET(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.id).toBe(TEST_EVENT_ID)
    expect(body.title).toBe('Standup')
  })

  it('returns 404 for non-existent event ID', async () => {
    mockAuthWithTables({ events: { data: null, error: { code: 'PGRST116' } } })

    const req = createRequest('GET', '/api/events/nonexistent')
    const res = await GET(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Event not found')
  })
})

describe('PATCH /api/events/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates event fields', async () => {
    const existing = {
      id: TEST_EVENT_ID,
      title: 'Old title',
      user_id: TEST_USER_ID,
      google_event_id: null,
      timezone: 'America/New_York',
      calendars: { google_account_id: 'ga-1', google_calendar_id: 'gc-1' },
    }
    const updated = { ...existing, title: 'New title' }

    // PATCH calls from('events') 3 times: fetch existing, update, re-fetch
    mockAuthWithTables({
      events: [
        { data: existing, error: null },  // fetch existing
        { data: updated, error: null },   // update
        { data: updated, error: null },   // re-fetch final
      ],
    })

    const req = createRequest('PATCH', `/api/events/${TEST_EVENT_ID}`, { title: 'New title' })
    const res = await PATCH(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.title).toBe('New title')
  })

  it('returns 400 for invalid JSON body', async () => {
    mockAuthWithTables({})

    const req = new NextRequest(new URL(`/api/events/${TEST_EVENT_ID}`, 'http://localhost:3000'), {
      method: 'PATCH',
      body: '{broken',
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await PATCH(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 404 when event does not exist', async () => {
    mockAuthWithTables({ events: { data: null, error: { code: 'PGRST116' } } })

    const req = createRequest('PATCH', `/api/events/${TEST_EVENT_ID}`, { title: 'Updated' })
    const res = await PATCH(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Event not found')
  })
})

describe('DELETE /api/events/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes event and returns 204', async () => {
    const existing = {
      id: TEST_EVENT_ID,
      user_id: TEST_USER_ID,
      google_event_id: null,
      calendars: { google_account_id: 'ga-1', google_calendar_id: 'gc-1' },
    }

    // DELETE: fetch existing (single), then delete (bare await)
    mockAuthWithTables({
      events: [
        { data: existing, error: null }, // fetch
        { data: null, error: null },     // delete
      ],
    })

    const req = createRequest('DELETE', `/api/events/${TEST_EVENT_ID}`)
    const res = await DELETE(req, routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(204)
  })

  it('returns 404 for non-existent event', async () => {
    mockAuthWithTables({ events: { data: null, error: { code: 'PGRST116' } } })

    const req = createRequest('DELETE', '/api/events/nonexistent')
    const res = await DELETE(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Event not found')
  })
})
