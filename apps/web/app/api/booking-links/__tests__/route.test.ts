import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Chainable Supabase mock
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown; count?: number }

function createChain(result: MockResult = { data: null, error: null }) {
  const chain: Record<string | symbol, unknown> = {}
  const methods = [
    'from', 'select', 'insert', 'update', 'delete',
    'eq', 'in', 'lt', 'gt', 'not', 'is', 'or', 'ilike',
    'order', 'limit', 'single', 'maybeSingle',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Terminal — resolves to result
  chain.then = (resolve: (v: MockResult) => void) => resolve(result)
  // Allow await on the chain itself
  chain[Symbol.toStringTag] = 'Promise'
  // Override single/select to also be thenable
  chain.single = vi.fn().mockReturnValue({
    ...chain,
    then: (resolve: (v: MockResult) => void) => resolve(result),
  })
  chain.select = vi.fn().mockImplementation(() => chain)
  return chain
}

function createSupabaseMock() {
  let defaultResult: MockResult = { data: null, error: null }
  const tableResults = new Map<string, MockResult[]>()

  function setResult(tableName: string, result: MockResult) {
    const existing = tableResults.get(tableName) ?? []
    existing.push(result)
    tableResults.set(tableName, existing)
  }

  function build() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        const results = tableResults.get(table) ?? []
        const result = results.shift() ?? defaultResult
        return createChain(result)
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
    }
  }

  return { setResult, setDefault: (r: MockResult) => { defaultResult = r }, build }
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockAuthenticate = vi.fn()

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  isAuthError: (result: Partial<Response>) => result instanceof Response || (result && typeof result.status === 'number' && typeof result.json === 'function'),
  validationError: (issues: { path: (string | number)[]; message: string }[]) => {
    const details: Record<string, string[]> = {}
    for (const issue of issues) {
      const key = issue.path.join('.') || '_root'
      if (!details[key]) details[key] = []
      details[key].push(issue.message)
    }
    return Response.json({ error: 'Validation error', details }, { status: 422 })
  },
}))

// Shared service-client factory for routes that call createServerClient directly
// (availability + book endpoints bypass authenticate and build their own client)
const serviceClientFactory = (): Record<string, unknown> => ({})

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => serviceClientFactory()),
}))

// Both the sync (rateLimit) and async (rateLimitAsync) limiters are stubbed to
// always allow — the availability/book routes gate on rateLimitAsync, and these
// tests exercise validation/404/409 paths, not the limiter itself.
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => true),
  rateLimitAsync: vi.fn(async () => true),
}))

vi.mock('@/lib/google/calendar', () => ({
  createGoogleEvent: vi.fn().mockResolvedValue({ id: 'gcal-1', etag: '"etag"', hangoutLink: null }),
  deleteGoogleEvent: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string, body?: unknown, url = 'http://localhost/api/booking-links') {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1])
}

const VALID_CREATE = {
  slug: 'intro-call',
  name: 'Intro Call',
  duration_minutes: 30,
  availability: [{ day: 'monday', start: '09:00', end: '17:00' }],
  timezone: 'America/New_York',
  is_public: true,
  requires_approval: false,
  buffer_minutes: 10,
  minimum_notice_hours: 2,
}

const BOOKING_LINK_ROW = {
  id: 'bl-1',
  user_id: 'user-123',
  ...VALID_CREATE,
  google_account_id: null,
  conferencing: true,
  location: null,
  notes: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Tests: GET list / POST create (booking-links/route.ts)
// ---------------------------------------------------------------------------

describe('GET /api/booking-links', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    const unauthorizedResponse = Response.json({ error: 'Unauthorized' }, { status: 401 })
    mockAuthenticate.mockResolvedValue(unauthorizedResponse)

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(401)
  })

  it('returns booking links for authenticated user', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: [BOOKING_LINK_ROW], error: null })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.items[0].slug).toBe('intro-call')
    expect(json.next_cursor).toBeNull()
  })

  it('returns 500 when DB query fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: null, error: { message: 'DB error' } })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(500)
  })
})

describe('POST /api/booking-links', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a booking link with valid data', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: BOOKING_LINK_ROW, error: null })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', VALID_CREATE))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.slug).toBe('intro-call')
  })

  it('returns 400 for invalid JSON body', async () => {
    const factory = createSupabaseMock()
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { POST } = await import('../route')
    const req = new NextRequest('http://localhost/api/booking-links', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 for missing required fields', async () => {
    const factory = createSupabaseMock()
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { name: 'Test' }))

    expect(res.status).toBe(422)
  })

  it('returns 409 for duplicate slug', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: null, error: { code: '23505', message: 'duplicate' } })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', VALID_CREATE))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toContain('slug already exists')
  })

  it('verifies google_account_id belongs to user when provided', async () => {
    const factory = createSupabaseMock()
    // First call: google_accounts check returns no match
    factory.setResult('google_accounts', { data: null, error: { code: 'PGRST116' } })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { POST } = await import('../route')
    const body = { ...VALID_CREATE, google_account_id: '00000000-0000-4000-8000-000000000001' }
    const res = await POST(makeRequest('POST', body))

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toContain('Google account not found')
  })
})

// ---------------------------------------------------------------------------
// Tests: GET single / PATCH / DELETE (booking-links/[id]/route.ts)
// ---------------------------------------------------------------------------

describe('GET /api/booking-links/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the booking link when it exists', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: BOOKING_LINK_ROW, error: null })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { GET } = await import('../[id]/route')
    const res = await GET(
      makeRequest('GET', undefined, 'http://localhost/api/booking-links/bl-1'),
      { params: Promise.resolve({ id: 'bl-1' }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('bl-1')
  })

  it('returns 404 when booking link does not exist', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: null, error: { code: 'PGRST116' } })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { GET } = await import('../[id]/route')
    const res = await GET(
      makeRequest('GET', undefined, 'http://localhost/api/booking-links/nonexistent'),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/booking-links/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates booking link with valid partial data', async () => {
    const factory = createSupabaseMock()
    // Ownership check
    factory.setResult('booking_links', { data: { id: 'bl-1' }, error: null })
    // Update result
    factory.setResult('booking_links', { data: { ...BOOKING_LINK_ROW, name: 'Updated' }, error: null })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { PATCH } = await import('../[id]/route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'Updated' }, 'http://localhost/api/booking-links/bl-1'),
      { params: Promise.resolve({ id: 'bl-1' }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.name).toBe('Updated')
  })

  it('returns 404 when updating non-existent booking link', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: null, error: { code: 'PGRST116' } })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { PATCH } = await import('../[id]/route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'Nope' }, 'http://localhost/api/booking-links/fake'),
      { params: Promise.resolve({ id: 'fake' }) },
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/booking-links/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes booking link and returns 204', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: null, error: null })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/booking-links/bl-1'),
      { params: Promise.resolve({ id: 'bl-1' }) },
    )

    expect(res.status).toBe(204)
  })

  it('returns 500 when delete fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('booking_links', { data: null, error: { message: 'FK constraint' } })
    const supabase = factory.build()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase })

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/booking-links/bl-1'),
      { params: Promise.resolve({ id: 'bl-1' }) },
    )

    expect(res.status).toBe(500)
  })
})
