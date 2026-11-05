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

const respond = vi.hoisted(() => vi.fn())
vi.mock('@/lib/google/calendar', async (original) => ({
  ...(await original<typeof import('@/lib/google/calendar')>()),
  respondToGoogleEvent: respond,
}))

import { authenticate } from '@/lib/auth/helpers'
import { NotAGuestError } from '@/lib/google/calendar'
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

const LOCAL = { data: { id: 'cal-local', source: 'local', google_account_id: null, google_calendar_id: null }, error: null }
const GOOGLE = { data: { id: 'cal-work', source: 'google', google_account_id: 'acct-work', google_calendar_id: 'work@group.test' }, error: null }

describe('POST /api/events/:id/rsvp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the answer on a local calendar, under the caller\'s profile email (API-key auth)', async () => {
    const event = { id: TEST_EVENT_ID, calendar_id: 'cal-local', google_event_id: null, attendees: [{ email: USER_EMAIL, response_status: 'needsAction' }] }
    const updatedEvent = { id: TEST_EVENT_ID, title: 'Standup', user_id: TEST_USER_ID, attendees: [{ email: USER_EMAIL, response_status: 'accepted' }] }
    const supabase = mockAuthWithTables({
      events: [{ data: event, error: null }, { data: updatedEvent, error: null }],
      calendars: LOCAL,
      profiles: { data: { email: USER_EMAIL }, error: null },
    })

    const res = await POST(createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'accepted' }), routeParams(TEST_EVENT_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    // Full event object, not just { id, response }.
    expect(body.title).toBe('Standup')
    const update = vi.mocked(supabase.from).mock.results[3]!.value.update as ReturnType<typeof vi.fn>
    expect(update.mock.calls[0]![0].attendees).toEqual([{ email: USER_EMAIL, response_status: 'accepted' }])
    expect(respond).not.toHaveBeenCalled()
    // Email came from profiles, never from auth.getUser.
    expect(supabase.from).toHaveBeenCalledWith('profiles')
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
  })

  it('appends the caller as an attendee on a local calendar when not already present', async () => {
    const supabase = mockAuthWithTables({
      events: [{ data: { id: TEST_EVENT_ID, calendar_id: 'cal-local', attendees: [] }, error: null }, { data: { id: TEST_EVENT_ID }, error: null }],
      calendars: LOCAL,
      profiles: { data: { email: USER_EMAIL }, error: null },
    })

    const res = await POST(createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'declined' }), routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(200)
    const update = vi.mocked(supabase.from).mock.results[3]!.value.update as ReturnType<typeof vi.fn>
    expect(update.mock.calls[0]![0].attendees).toEqual([{ email: USER_EMAIL, response_status: 'declined' }])
  })

  it('sends the reply to Google as the calendar\'s account and stores the guest list Google returns', async () => {
    const event = { id: TEST_EVENT_ID, calendar_id: 'cal-work', google_event_id: 'kickoff', attendees: [] }
    respond.mockResolvedValue({
      id: 'kickoff',
      etag: '"etag-9"',
      attendees: [{ email: 'nate@work.test', responseStatus: 'tentative', self: true }, { email: 'boss@work.test', responseStatus: 'accepted' }],
    })
    const supabase = mockAuthWithTables({
      events: [{ data: event, error: null }, { data: { id: TEST_EVENT_ID, title: 'Kickoff' }, error: null }],
      calendars: GOOGLE,
      google_accounts: { data: { email: 'nate@work.test' }, error: null },
    })

    const res = await POST(createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'tentative' }), routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(200)
    expect(respond).toHaveBeenCalledWith('acct-work', 'work@group.test', 'kickoff', 'nate@work.test', 'tentative')
    const update = vi.mocked(supabase.from).mock.results[3]!.value.update as ReturnType<typeof vi.fn>
    expect(update.mock.calls[0]![0]).toEqual({
      attendees: [
        { email: 'nate@work.test', name: undefined, response_status: 'tentative', self: true },
        { email: 'boss@work.test', name: undefined, response_status: 'accepted' },
      ],
      etag: '"etag-9"',
    })
    expect(supabase.from).not.toHaveBeenCalledWith('profiles')
  })

  it('says so when Google refuses the reply, and changes nothing here', async () => {
    respond.mockRejectedValue(new Error('Google Calendar API error: 500'))
    const supabase = mockAuthWithTables({
      events: { data: { id: TEST_EVENT_ID, calendar_id: 'cal-work', google_event_id: 'kickoff', attendees: [] }, error: null },
      calendars: GOOGLE,
      google_accounts: { data: { email: 'nate@work.test' }, error: null },
    })

    const res = await POST(createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'declined' }), routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Google/)
    expect(vi.mocked(supabase.from).mock.calls.filter(([table]) => table === 'events')).toHaveLength(1)
  })

  it('refuses a reply from an account that is not a guest', async () => {
    respond.mockRejectedValue(new NotAGuestError('not a guest'))
    mockAuthWithTables({
      events: { data: { id: TEST_EVENT_ID, calendar_id: 'cal-work', google_event_id: 'kickoff', attendees: [] }, error: null },
      calendars: GOOGLE,
      google_accounts: { data: { email: 'nate@work.test' }, error: null },
    })

    const res = await POST(createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'accepted' }), routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(422)
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

  it('returns 422 for an invalid response value', async () => {
    mockAuthWithTables({})

    const req = createRequest(`/api/events/${TEST_EVENT_ID}/rsvp`, { response: 'maybe' })
    const res = await POST(req, routeParams(TEST_EVENT_ID))

    expect(res.status).toBe(422)
  })
})
