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
  chain.then = (resolve: (v: MockResult) => void) => resolve(result)
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
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string, body?: unknown, url = 'http://localhost/api/api-keys') {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1])
}

const API_KEY_ROW = {
  id: 'key-1',
  name: 'My Key',
  key_prefix: 'pk_abcde',
  last_used_at: null,
  created_at: '2026-06-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Tests: GET (api-keys/route.ts)
// ---------------------------------------------------------------------------

describe('GET /api/api-keys', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(401)
  })

  it('returns API keys with prefix only (no full keys)', async () => {
    const factory = createSupabaseMock()
    factory.setResult('api_keys', {
      data: [API_KEY_ROW, { ...API_KEY_ROW, id: 'key-2', name: 'Second Key', key_prefix: 'pk_12345' }],
      error: null,
    })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveLength(2)
    // Verify no full key is returned, only prefix
    expect(json[0].key_prefix).toBe('pk_abcde')
    expect(json[0].key).toBeUndefined()
    expect(json[0].key_hash).toBeUndefined()
  })

  it('returns 500 when DB query fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('api_keys', { data: null, error: { message: 'DB error' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST (api-keys/route.ts)
// ---------------------------------------------------------------------------

describe('POST /api/api-keys', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generates a new key and returns full key once', async () => {
    const factory = createSupabaseMock()
    factory.setResult('api_keys', { data: API_KEY_ROW, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { name: 'My Key' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.name).toBe('My Key')
    // Full key should be present exactly once on creation
    expect(json.key).toBeDefined()
    expect(json.key).toMatch(/^pk_[0-9a-f]{32}$/)
    expect(json.key_prefix).toBeDefined()
  })

  it('returns 400 for invalid JSON body', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const req = new NextRequest('http://localhost/api/api-keys', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', {}))

    expect(res.status).toBe(400)
  })

  it('returns 400 when name is empty string', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { name: '' }))

    expect(res.status).toBe(400)
  })

  it('returns 500 when DB insert fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('api_keys', { data: null, error: { message: 'DB error' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest('POST', { name: 'Failing Key' }))

    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Tests: DELETE (api-keys/[id]/route.ts)
// ---------------------------------------------------------------------------

describe('DELETE /api/api-keys/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('revokes key and returns 204', async () => {
    const factory = createSupabaseMock()
    factory.setResult('api_keys', { data: null, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/api-keys/key-1'),
      { params: Promise.resolve({ id: 'key-1' }) },
    )

    expect(res.status).toBe(204)
  })

  it('returns 500 when delete fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('api_keys', { data: null, error: { message: 'FK constraint' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/api-keys/key-1'),
      { params: Promise.resolve({ id: 'key-1' }) },
    )

    expect(res.status).toBe(500)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { DELETE } = await import('../[id]/route')
    const res = await DELETE(
      makeRequest('DELETE', undefined, 'http://localhost/api/api-keys/key-1'),
      { params: Promise.resolve({ id: 'key-1' }) },
    )

    expect(res.status).toBe(401)
  })
})
