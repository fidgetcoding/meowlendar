import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Supabase mock ──────────────────────────────────────────────────────────────

const mockFrom = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader) headers['authorization'] = authHeader
  return new NextRequest('https://app.poolendar.com/api/events', { headers })
}

/**
 * SHA-256 hex digest of `input`, matching the production path
 * (crypto.subtle.digest → Buffer.from → hex).
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return Buffer.from(new Uint8Array(hashBuf)).toString('hex')
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('authenticateApiKey', () => {
  let authenticateApiKey: typeof import('../api-key').authenticateApiKey

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

    const mod = await import('../api-key')
    authenticateApiKey = mod.authenticateApiKey
  })

  it('returns null when Authorization header is missing', async () => {
    const request = buildRequest()
    const result = await authenticateApiKey(request)
    expect(result).toBeNull()
  })

  it('returns null when Bearer token does not start with pk_', async () => {
    const request = buildRequest('Bearer sk_abcdefghij')
    const result = await authenticateApiKey(request)
    expect(result).toBeNull()
  })

  it('returns null when prefix matches no rows in api_keys', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })

    const request = buildRequest('Bearer pk_test1234rest_of_key')
    const result = await authenticateApiKey(request)
    expect(result).toBeNull()
  })

  it('returns null when the query returns an error', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
      }),
    })

    const request = buildRequest('Bearer pk_test1234rest_of_key')
    const result = await authenticateApiKey(request)
    expect(result).toBeNull()
  })

  it('returns userId when key hash matches (timing-safe)', async () => {
    const apiKey = 'pk_test1234rest_of_key'
    const keyHash = await sha256Hex(apiKey)

    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdateCall = vi.fn().mockReturnValue({ eq: mockUpdateEq })

    // First call: select for lookup; second call: update last_used_at
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'key-1', user_id: 'user-abc', key_hash: keyHash }],
              error: null,
            }),
          }),
        }
      }
      return { update: mockUpdateCall }
    })

    const request = buildRequest(`Bearer ${apiKey}`)
    const result = await authenticateApiKey(request)

    expect(result).toEqual({ userId: 'user-abc', keyId: 'key-1' })
    // Verify last_used_at was updated
    expect(mockUpdateCall).toHaveBeenCalledWith(
      expect.objectContaining({ last_used_at: expect.any(String) })
    )
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'key-1')
  })

  it('returns null when key hash does not match any candidate', async () => {
    const apiKey = 'pk_test1234rest_of_key'
    const wrongHash = 'ff'.repeat(32) // 64-char hex, won't match SHA-256 of apiKey

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [{ id: 'key-1', user_id: 'user-abc', key_hash: wrongHash }],
          error: null,
        }),
      }),
    })

    const request = buildRequest(`Bearer ${apiKey}`)
    const result = await authenticateApiKey(request)
    expect(result).toBeNull()
  })

  it('updates last_used_at on successful authentication', async () => {
    const apiKey = 'pk_test1234rest_of_key'
    const keyHash = await sha256Hex(apiKey)

    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdateCall = vi.fn().mockReturnValue({ eq: mockUpdateEq })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'key-99', user_id: 'user-xyz', key_hash: keyHash }],
              error: null,
            }),
          }),
        }
      }
      return { update: mockUpdateCall }
    })

    const request = buildRequest(`Bearer ${apiKey}`)
    await authenticateApiKey(request)

    expect(mockUpdateCall).toHaveBeenCalledTimes(1)
    const updateArg = mockUpdateCall.mock.calls[0]![0]
    expect(updateArg).toHaveProperty('last_used_at')
    // Verify it's a valid ISO timestamp
    expect(new Date(updateArg.last_used_at).toISOString()).toBe(updateArg.last_used_at)
  })

  it('extracts the correct 8-char prefix for DB lookup', async () => {
    const apiKey = 'pk_test1234rest_of_key'
    const expectedPrefix = 'pk_test1' // first 8 chars of the key

    const selectEq = vi.fn().mockResolvedValue({ data: [], error: null })
    const selectFn = vi.fn().mockReturnValue({ eq: selectEq })

    mockFrom.mockReturnValue({ select: selectFn })

    const request = buildRequest(`Bearer ${apiKey}`)
    await authenticateApiKey(request)

    expect(selectEq).toHaveBeenCalledWith('key_prefix', expectedPrefix)
  })
})
