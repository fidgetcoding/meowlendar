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

function makeRequest(method: string, body?: unknown) {
  const url = 'http://localhost/api/profile'
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1])
}

const PROFILE_ROW = {
  id: 'user-123',
  display_name: 'Nate',
  company: 'Lorecraft LLC',
  avatar_url: null,
  settings: { theme: 'light' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

// ---------------------------------------------------------------------------
// Tests: GET (profile/route.ts)
// ---------------------------------------------------------------------------

describe('GET /api/profile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(401)
  })

  it('returns user profile', async () => {
    const factory = createSupabaseMock()
    factory.setResult('profiles', { data: PROFILE_ROW, error: null })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.display_name).toBe('Nate')
    expect(json.company).toBe('Lorecraft LLC')
  })

  it('returns 404 when profile does not exist', async () => {
    const factory = createSupabaseMock()
    factory.setResult('profiles', { data: null, error: { code: 'PGRST116' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { GET } = await import('../route')
    const res = await GET(makeRequest('GET'))

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH (profile/route.ts)
// ---------------------------------------------------------------------------

describe('PATCH /api/profile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates display_name', async () => {
    const factory = createSupabaseMock()
    factory.setResult('profiles', {
      data: { ...PROFILE_ROW, display_name: 'Updated' },
      error: null,
    })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', { display_name: 'Updated' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.display_name).toBe('Updated')
  })

  it('updates company', async () => {
    const factory = createSupabaseMock()
    factory.setResult('profiles', {
      data: { ...PROFILE_ROW, company: 'New Corp' },
      error: null,
    })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', { company: 'New Corp' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.company).toBe('New Corp')
  })

  it('merges settings with existing settings', async () => {
    const factory = createSupabaseMock()
    // First: existing settings fetch
    factory.setResult('profiles', {
      data: { settings: { theme: 'light', timezone: 'EST' } },
      error: null,
    })
    // Second: update result
    factory.setResult('profiles', {
      data: { ...PROFILE_ROW, settings: { theme: 'dark', timezone: 'EST' } },
      error: null,
    })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', { settings: { theme: 'dark' } }))
    const json = await res.json()

    expect(res.status).toBe(200)
    // Settings should be merged: theme updated, timezone preserved
    expect(json.settings.theme).toBe('dark')
    expect(json.settings.timezone).toBe('EST')
  })

  it('returns 400 when settings payload exceeds 10KB', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    // Generate a settings object > 10KB
    const bigSettings: Record<string, string> = {}
    for (let i = 0; i < 200; i++) {
      bigSettings[`key_${i}`] = 'x'.repeat(100)
    }
    const res = await PATCH(makeRequest('PATCH', { settings: bigSettings }))

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const req = new NextRequest('http://localhost/api/profile', {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 when no fields to update', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', {}))

    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid avatar_url (not a URL)', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', { avatar_url: 'not-a-url' }))

    expect(res.status).toBe(400)
  })

  it('accepts valid avatar_url', async () => {
    const factory = createSupabaseMock()
    factory.setResult('profiles', {
      data: { ...PROFILE_ROW, avatar_url: 'https://example.com/photo.jpg' },
      error: null,
    })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', { avatar_url: 'https://example.com/photo.jpg' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.avatar_url).toBe('https://example.com/photo.jpg')
  })

  it('returns 500 when DB update fails', async () => {
    const factory = createSupabaseMock()
    factory.setResult('profiles', { data: null, error: { message: 'DB error' } })
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { PATCH } = await import('../route')
    const res = await PATCH(makeRequest('PATCH', { display_name: 'Fails' }))

    expect(res.status).toBe(500)
  })
})
