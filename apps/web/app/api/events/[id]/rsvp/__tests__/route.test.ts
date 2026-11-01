import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────────────

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

import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_EVENT_ID = '00000000-0000-4000-8000-000000000010'
const USER_EMAIL = 'user@example.com'

function createRequest(url: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
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
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
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
    // No auth.getUser here — the fix must resolve the email from profiles.
    auth: {
      getUser: vi.fn().mockRejectedValue(new Error('auth.getUser must not be used for API-key callers')),
    },
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

describe('POST /api/events/:id/rsvp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates an existing attendee and returns the full event (API-key auth)', async () => {
    const event = {
      id: TEST_EVENT_ID,
      attendees: [{ email: USER_EMAIL, response: 'needsAction' }],
    }
    const updatedEvent = {
      id: TEST_EVENT_ID,
      title: 'Standup',
      user_id: TEST_USER_ID,
      attendees: [{ email: USER_EMAIL, response: 'accepted' }],
    }

    const supabase = mockAuthWithTables({
      events: [
        { data: event, error: null },        // fetch event
        { data: updatedEvent, error: null },  // update
      ],
      profiles: { data: { email: USER_EMAIL }, error: null },
    })

    const req = createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'accepted' })
    const res = await POST(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    // Full event object, not just { id, response }.
    expect(body.title).toBe('Standup')
    expect(body.attendees[0].response).toBe('accepted')
    // Email came from profiles, never from auth.getUser.
    expect(supabase.from).toHaveBeenCalledWith('profiles')
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('appends the caller as an attendee when not already present', async () => {
    const event = { id: TEST_EVENT_ID, attendees: [] }
    const updatedEvent = {
      id: TEST_EVENT_ID,
      title: 'Planning',
      attendees: [{ email: USER_EMAIL, response: 'declined' }],
    }

    mockAuthWithTables({
      events: [
        { data: event, error: null },
        { data: updatedEvent, error: null },
      ],
      profiles: { data: { email: USER_EMAIL }, error: null },
    })

    const req = createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'declined' })
    const res = await POST(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.attendees).toHaveLength(1)
    expect(body.attendees[0].email).toBe(USER_EMAIL)
    expect(body.attendees[0].response).toBe('declined')
  })

  it('returns 404 when the event is not owned by the caller', async () => {
    mockAuthWithTables({
      events: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'accepted' })
    const res = await POST(req, routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Event not found')
  })

  it('returns 400 for an invalid response value', async () => {
    mockAuthWithTables({})

    const req = createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'maybe' })
    const res = await POST(req, routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(422)
  })
})
