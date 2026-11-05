import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Chainable Supabase mock
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown }

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
  let offset = 0
  let end: number | undefined
  chain.range = vi.fn((from: number, to: number) => { offset = from; end = to + 1; return chain })
  chain.then = (resolve: (v: MockResult) => void) => resolve({ ...result, data: Array.isArray(result.data) ? result.data.slice(offset, end) : result.data })
  chain[Symbol.toStringTag] = 'Promise'
  chain.single = vi.fn().mockReturnValue({
    ...chain,
    then: (resolve: (v: MockResult) => void) => resolve(result),
  })
  chain.select = vi.fn().mockImplementation(() => chain)
  return chain
}

function createSupabaseMock() {
  let defaultResult: MockResult = { data: [], error: null }
  const tableResults = new Map<string, MockResult[]>()

  function setResult(table: string, result: MockResult) {
    const existing = tableResults.get(table) ?? []
    existing.push(result)
    tableResults.set(table, existing)
  }

  function build() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        const results = tableResults.get(table) ?? []
        const result = results.shift() ?? defaultResult
        return createChain(result)
      }),
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
  isAuthError: (result: Partial<Response>) =>
    result instanceof Response ||
    (result && typeof result.status === 'number' && typeof result.json === 'function'),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchRequest(query: string, extra = '') {
  const url = `http://localhost/api/search?q=${encodeURIComponent(query)}${extra}`
  return new NextRequest(url)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { GET } = await import('../route')
    const res = await GET(makeSearchRequest('test'))

    expect(res.status).toBe(401)
  })

  it('returns 400 when q param is missing', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(new NextRequest('http://localhost/api/search'))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Missing')
  })

  it('returns 400 when q param is empty', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(new NextRequest('http://localhost/api/search?q='))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('Missing')
  })

  it('returns matching results across entity types', async () => {
    const factory = createSupabaseMock()
    // Events title+notes search
    factory.setResult('events', {
      data: [{
        id: 'e-1',
        title: 'Team standup',
        notes: 'Daily sync meeting',
        start_time: '2026-06-10T09:00:00Z',
      }],
      error: null,
    })
    // Events attendee search
    factory.setResult('events', { data: [], error: null })
    // Tasks title+notes search
    factory.setResult('tasks', {
      data: [{
        id: 't-1',
        title: 'Fix standup bot',
        notes: null,
        due_date: '2026-06-15',
        created_at: '2026-06-01T00:00:00Z',
      }],
      error: null,
    })
    // Tasks tag search
    factory.setResult('tasks', { data: [], error: null })
    // Routines
    factory.setResult('routines', { data: [], error: null })
    // Booking links
    factory.setResult('booking_links', { data: [], error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeSearchRequest('standup'))
    const json = (await res.json()).items

    expect(res.status).toBe(200)
    expect(json.length).toBeGreaterThanOrEqual(2)
    const ids = json.map((r: { id: string }) => r.id)
    expect(ids).toContain('e-1')
    expect(ids).toContain('t-1')
  })

  it('filters by types parameter', async () => {
    const factory = createSupabaseMock()
    // Only task search should run (title+notes + tags)
    factory.setResult('tasks', {
      data: [{
        id: 't-1',
        title: 'Test task',
        notes: null,
        due_date: null,
        created_at: '2026-06-01T00:00:00Z',
      }],
      error: null,
    })
    factory.setResult('tasks', { data: [], error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeSearchRequest('test', '&types=task'))
    const json = (await res.json()).items

    expect(res.status).toBe(200)
    expect(json.every((r: { type: string }) => r.type === 'task')).toBe(true)
  })

  it('keeps the documented unpaginated response when no limit is supplied', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tasks', { data: Array.from({ length: 30 }, (_, i) => ({ id: `t-${i}`, title: 'Match', notes: null, due_date: null, created_at: '2030-01-01T00:00:00Z' })), error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })
    const { GET } = await import('../route')
    const response = await GET(makeSearchRequest('Match', '&types=task'))
    expect(response.status).toBe(200)
    expect((await response.json()).items).toHaveLength(30)
  })

  it('respects limit parameter (capped at 50)', async () => {
    const factory = createSupabaseMock()
    // Return data for all entity types
    factory.setDefault({ data: [], error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeSearchRequest('test', '&limit=5'))
    const json = (await res.json()).items

    expect(res.status).toBe(200)
    expect(json.length).toBeLessThanOrEqual(5)
  })

  it('deduplicates results across search strategies', async () => {
    const factory = createSupabaseMock()
    // Same event returned from both title and attendee search
    const event = {
      id: 'e-1',
      title: 'Meeting with alice',
      notes: null,
      start_time: '2026-06-10T09:00:00Z',
      attendees: [{ email: 'alice@example.com' }],
    }
    factory.setResult('events', { data: [event], error: null })
    factory.setResult('events', { data: [event], error: null })
    factory.setResult('tasks', { data: [], error: null })
    factory.setResult('tasks', { data: [], error: null })
    factory.setResult('routines', { data: [], error: null })
    factory.setResult('booking_links', { data: [], error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeSearchRequest('alice'))
    const json = (await res.json()).items

    expect(res.status).toBe(200)
    // Should only have one entry for e-1 despite two search strategies matching
    const eventResults = json.filter((r: { id: string }) => r.id === 'e-1')
    expect(eventResults).toHaveLength(1)
  })

  it('returns a meeting on two accounts once, and both with merge=false', async () => {
    const copy = (id: string, calendar_id: string) => ({
      id, calendar_id, ical_uid: 'kickoff@google.com', title: 'Kickoff', notes: null,
      start_time: '2026-06-10T09:00:00Z', end_time: '2026-06-10T10:00:00Z', attendees: [],
    })
    const search = async (extra = '') => {
      const factory = createSupabaseMock()
      factory.setResult('events', { data: [copy('work', 'cal-work'), copy('home', 'cal-home')], error: null })
      factory.setResult('events', { data: [], error: null })
      factory.setResult('tasks', { data: [], error: null })
      factory.setResult('tasks', { data: [], error: null })
      factory.setResult('routines', { data: [], error: null })
      factory.setResult('booking_links', { data: [], error: null })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })
      const { GET } = await import('../route')
      return (await (await GET(makeSearchRequest('Kickoff', extra))).json()).items.map((r: { id: string }) => r.id)
    }
    expect(await search()).toEqual(['work'])
    expect((await search('&merge=false')).sort()).toEqual(['home', 'work'])
  })

  it('sorts results by date descending', async () => {
    const factory = createSupabaseMock()
    factory.setResult('events', {
      data: [
        { id: 'e-old', title: 'Old meeting', notes: null, start_time: '2026-01-01T00:00:00Z' },
        { id: 'e-new', title: 'New meeting', notes: null, start_time: '2026-06-10T00:00:00Z' },
      ],
      error: null,
    })
    factory.setResult('events', { data: [], error: null })
    factory.setResult('tasks', { data: [], error: null })
    factory.setResult('tasks', { data: [], error: null })
    factory.setResult('routines', { data: [], error: null })
    factory.setResult('booking_links', { data: [], error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeSearchRequest('meeting'))
    const json = (await res.json()).items

    expect(res.status).toBe(200)
    expect(json[0].id).toBe('e-new')
    expect(json[1].id).toBe('e-old')
  })
})
