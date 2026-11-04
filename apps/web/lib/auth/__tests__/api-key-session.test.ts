import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserById = vi.fn()
const generateLink = vi.fn()
const verifyOtp = vi.fn()
const refreshSession = vi.fn()
const maybeSingle = vi.fn()
const upsert = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { getUserById, generateLink }, verifyOtp, refreshSession },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    }),
  })),
}))

const NOW_S = () => Math.floor(Date.now() / 1000)

describe('getApiKeyAccessToken', () => {
  let mod: typeof import('../api-key-session')
  let crypto: typeof import('../../crypto')

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
    delete process.env.SUPABASE_JWT_SECRET
    upsert.mockResolvedValue({ error: null })
    getUserById.mockResolvedValue({ data: { user: { email: 'a@example.com' } }, error: null })
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'hash' } }, error: null })
    verifyOtp.mockResolvedValue({
      data: { session: { access_token: 'minted', refresh_token: 'r1', expires_at: NOW_S() + 3600 } },
      error: null,
    })
    mod = await import('../api-key-session')
    crypto = await import('../../crypto')
  })

  it('mints a session on first use, with no JWT secret set', async () => {
    maybeSingle.mockResolvedValue({ data: null })

    await expect(mod.getApiKeyAccessToken('key-1', 'user-1')).resolves.toBe('minted')

    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'a@example.com' })
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'hash' })
  })

  it('shares one session mint across concurrent requests for the same key', async () => {
    maybeSingle.mockResolvedValue({ data: null })
    const tokens = await Promise.all(Array.from({ length: 8 }, () =>
      mod.getApiKeyAccessToken('key-1', 'user-1')))
    expect(tokens).toEqual(Array(8).fill('minted'))
    expect(generateLink).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('stores tokens encrypted, never in plain text', async () => {
    maybeSingle.mockResolvedValue({ data: null })

    await mod.getApiKeyAccessToken('key-1', 'user-1')

    const row = upsert.mock.calls[0]![0]
    expect(row.key_id).toBe('key-1')
    expect(row.access_token).not.toContain('minted')
    expect(row.refresh_token).not.toContain('r1')
    expect(crypto.decryptToken(row.access_token)).toBe('minted')
  })

  it('reuses the token from memory without calling Auth or the database', async () => {
    maybeSingle.mockResolvedValue({ data: null })

    await mod.getApiKeyAccessToken('key-1', 'user-1')
    await mod.getApiKeyAccessToken('key-1', 'user-1')

    expect(generateLink).toHaveBeenCalledTimes(1)
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('reuses a stored session that is still valid', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        access_token: crypto.encryptToken('stored'),
        refresh_token: crypto.encryptToken('r0'),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    })

    await expect(mod.getApiKeyAccessToken('key-1', 'user-1')).resolves.toBe('stored')
    expect(generateLink).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('refreshes an expired stored session instead of minting', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        access_token: crypto.encryptToken('old'),
        refresh_token: crypto.encryptToken('r0'),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    })
    refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh', refresh_token: 'r2', expires_at: NOW_S() + 3600 } },
      error: null,
    })

    await expect(mod.getApiKeyAccessToken('key-1', 'user-1')).resolves.toBe('fresh')
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'r0' })
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('mints again when the refresh token is rejected', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        access_token: crypto.encryptToken('old'),
        refresh_token: crypto.encryptToken('revoked'),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    })
    refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('revoked') })

    await expect(mod.getApiKeyAccessToken('key-1', 'user-1')).resolves.toBe('minted')
  })

  it('mints again when stored tokens cannot be decrypted', async () => {
    maybeSingle.mockResolvedValue({
      data: { access_token: 'not-encrypted', refresh_token: 'nope', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    })

    await expect(mod.getApiKeyAccessToken('key-1', 'user-1')).resolves.toBe('minted')
  })

  it('fails closed when Auth refuses, as for a banned user', async () => {
    maybeSingle.mockResolvedValue({ data: null })
    verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error('banned') })

    await expect(mod.getApiKeyAccessToken('key-1', 'user-1')).rejects.toThrow(/refused/)
  })
})
