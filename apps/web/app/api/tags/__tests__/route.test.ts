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
  chain.range = (from: number, to: number) => { offset = from; end = to + 1; return chain }
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
  let defaultResult: MockResult = { data: null, error: null }
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string, body?: unknown, url = 'http://localhost/api/tags') {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1])
}

const VALID_TAG = {
  name: 'work',
  color: '#ff6600',
}

const TAG_ROW = {
  id: 'tag-1',
  user_id: 'user-123',
  name: 'work',
  color: '#ff6600',
  prefix: null,
  created_at: '2026-06-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Tests: GET list / POST create (tags/route.ts)
// ---------------------------------------------------------------------------

describe('GET /api/tags', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(401)
  })

  it('returns tags ordered by name', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: [TAG_ROW], error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.items).toHaveLength(1)
    expect(json.items[0].name).toBe('work')
    expect(json.next_cursor).toBeNull()
  })

  it('returns 500 when DB query fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: null, error: { message: 'DB error' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(500)
  })
})

describe('POST /api/tags', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a tag with valid data', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: TAG_ROW, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', VALID_TAG))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.name).toBe('work')
    expect(json.color).toBe('#ff6600')
  })

  it('returns 400 for invalid JSON body', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const req = new NextRequest('http://localhost/api/tags', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 for missing name field', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { color: '#ff6600' }))

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid color format', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { name: 'test', color: 'red' }))

    expect(res.status).toBe(422)
  })

  it('returns 400 for color with wrong length', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { name: 'test', color: '#fff' }))

    expect(res.status).toBe(422)
  })

  it('returns 409 for duplicate tag name', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: null, error: { code: '23505', message: 'duplicate' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', VALID_TAG))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toContain('name already exists')
  })

  it('accepts optional prefix', async () => {
    const factory = createSupabaseMock()
    const tagWithPrefix = { ...TAG_ROW, prefix: 'WK' }
    factory.setResult('tags', { data: tagWithPrefix, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { ...VALID_TAG, prefix: 'WK' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.prefix).toBe('WK')
  })
})

// ---------------------------------------------------------------------------
// Tests: GET single / PATCH / DELETE (tags/[id]/route.ts)
// ---------------------------------------------------------------------------

describe('GET /api/tags/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the tag by ID', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: TAG_ROW, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../[id]/route')
    const res = await GET(
      makeRequest('GET', undefined, 'http://localhost/api/tags/tag-1'),
      { params: Promise.resolve({ id: 'tag-1' }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.id).toBe('tag-1')
  })

  it('returns 404 when tag does not exist', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: null, error: { code: 'PGRST116' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../[id]/route')
    const res = await GET(
      makeRequest('GET', undefined, 'http://localhost/api/tags/fake'),
      { params: Promise.resolve({ id: 'fake' }) },
    )

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/tags/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates tag with valid partial data', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: { ...TAG_ROW, name: 'personal' }, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../[id]/route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'personal' }, 'http://localhost/api/tags/tag-1'),
      { params: Promise.resolve({ id: 'tag-1' }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.name).toBe('personal')
  })

  it('returns 409 for duplicate name on update', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: null, error: { code: '23505' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../[id]/route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'taken' }, 'http://localhost/api/tags/tag-1'),
      { params: Promise.resolve({ id: 'tag-1' }) },
    )

    expect(res.status).toBe(409)
  })

  it('returns 404 when tag not found', async () => {
    const factory = createSupabaseMock()
    // Non-23505 error treated as not-found
    factory.setResult('tags', { data: null, error: { code: 'PGRST116' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../[id]/route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'nope' }, 'http://localhost/api/tags/fake'),
      { params: Promise.resolve({ id: 'fake' }) },
    )

    expect(res.status).toBe(404)
  })

  it('validates color format on update', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../[id]/route')
    const res = await PATCH(
      makeRequest('PATCH', { color: 'not-hex' }, 'http://localhost/api/tags/tag-1'),
      { params: Promise.resolve({ id: 'tag-1' }) },
    )

    expect(res.status).toBe(422)
  })
})

describe('DELETE /api/tags/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes tag and returns 204', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: null, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/tags/tag-1'),
      { params: Promise.resolve({ id: 'tag-1' }) },
    )

    expect(res.status).toBe(204)
  })

  it('returns 500 when delete fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('tags', { data: null, error: { message: 'FK constraint' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/tags/tag-1'),
      { params: Promise.resolve({ id: 'tag-1' }) },
    )

    expect(res.status).toBe(500)
  })
})
