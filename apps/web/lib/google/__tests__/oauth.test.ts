import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────────

const mockUpsert = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockDelete = vi.fn()
const mockEq = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      upsert: mockUpsert,
      select: mockSelect,
      single: mockSingle,
      delete: mockDelete,
      eq: mockEq,
    }),
  })),
}))

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Google OAuth', () => {
  let getGoogleOAuthUrl: typeof import('../oauth').getGoogleOAuthUrl
  let exchangeCodeForTokens: typeof import('../oauth').exchangeCodeForTokens

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis.fetch as Mock).mockReset()

    process.env.GOOGLE_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')

    const mod = await import('../oauth')
    getGoogleOAuthUrl = mod.getGoogleOAuthUrl
    exchangeCodeForTokens = mod.exchangeCodeForTokens
  })

  // ── getGoogleOAuthUrl ───────────────────────────────────────────────────

  describe('getGoogleOAuthUrl()', () => {
    it('generates a URL with all required OAuth parameters', () => {
      const url = getGoogleOAuthUrl('signed-state-123', 'https://app.poolendar.com/callback')
      const parsed = new URL(url)

      expect(parsed.origin).toBe('https://accounts.google.com')
      expect(parsed.pathname).toBe('/o/oauth2/v2/auth')
      expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
      expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.poolendar.com/callback')
      expect(parsed.searchParams.get('response_type')).toBe('code')
      expect(parsed.searchParams.get('access_type')).toBe('offline')
      expect(parsed.searchParams.get('prompt')).toBe('select_account consent')
      expect(parsed.searchParams.get('state')).toBe('signed-state-123')
    })

    it('includes calendar and userinfo scopes', () => {
      const url = getGoogleOAuthUrl('state', 'https://example.com/cb')
      const parsed = new URL(url)
      const scope = parsed.searchParams.get('scope') ?? ''

      expect(scope).toContain('calendar.events')
      expect(scope).toContain('calendar.readonly')
      expect(scope).toContain('calendar.settings.readonly')
      expect(scope).toContain('userinfo.email')
    })
  })

  // ── exchangeCodeForTokens ─────────────────────────────────────────────

  describe('exchangeCodeForTokens()', () => {
    it('exchanges auth code for tokens and fetches user email', async () => {
      ;(globalThis.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'at_123',
            refresh_token: 'rt_456',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'user@example.com' }),
        })

      const result = await exchangeCodeForTokens(
        'auth-code-xyz',
        'https://app.poolendar.com/callback'
      )

      expect(result).toEqual({
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
        email: 'user@example.com',
      })

      // Verify the token exchange request
      const tokenCall = (globalThis.fetch as Mock).mock.calls[0]!
      expect(tokenCall[0]).toBe('https://oauth2.googleapis.com/token')
      const body = new URLSearchParams(tokenCall[1].body)
      expect(body.get('code')).toBe('auth-code-xyz')
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('client_id')).toBe('test-client-id')
      expect(body.get('client_secret')).toBe('test-client-secret')
    })

    it('throws when token exchange HTTP response is not ok', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      })

      await expect(
        exchangeCodeForTokens('bad-code', 'https://example.com/cb')
      ).rejects.toThrow('Google token exchange failed: 400')
    })

    it('returns an undefined refresh_token when Google omits it (re-consent)', async () => {
      ;(globalThis.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'at_123',
            // no refresh_token — Google omits it when offline access already granted
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ email: 'user@example.com' }),
        })

      const result = await exchangeCodeForTokens('code', 'https://example.com/cb')

      // No throw — saveGoogleAccount preserves the token already on file.
      expect(result.refresh_token).toBeUndefined()
      expect(result.access_token).toBe('at_123')
      expect(result.email).toBe('user@example.com')
    })

    it('throws when userinfo fetch fails', async () => {
      ;(globalThis.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'at_123',
            refresh_token: 'rt_456',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        })

      await expect(
        exchangeCodeForTokens('code', 'https://example.com/cb')
      ).rejects.toThrow('Failed to fetch Google user info')
    })
  })

  // ── disconnectGoogleAccount ───────────────────────────────────────────

  describe('disconnectGoogleAccount()', () => {
    it('revokes token and deletes the account row', async () => {
      const { encryptToken } = await import('../../crypto')
      const storedRefresh = encryptToken('rt_456')
      const mockDeleteEq = vi.fn().mockResolvedValue({ error: null })
      const mockSelectChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                access_token: encryptToken('at_123'),
                refresh_token: storedRefresh,
              },
              error: null,
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }),
      }

      // Re-import with fresh mock
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue(mockSelectChain),
      })
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: true })

      const mod = await import('../oauth')
      await mod.disconnectGoogleAccount('acct-1')

      // Verify revocation was attempted with the refresh_token
      const revokeCall = (globalThis.fetch as Mock).mock.calls[0]!
      expect(revokeCall[0]).toContain('oauth2.googleapis.com/revoke')
      expect(revokeCall[0]).toContain('rt_456')
    })

    it('does not throw when token revocation fails', async () => {
      const mockDeleteEq = vi.fn().mockResolvedValue({ error: null })
      const mockSelectChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                access_token: 'at_123',
                refresh_token: 'rt_456',
              },
              error: null,
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }),
      }

      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue(mockSelectChain),
      })

      // Revocation throws
      ;(globalThis.fetch as Mock).mockRejectedValueOnce(new Error('network fail'))

      const mod = await import('../oauth')
      // Should NOT throw — revocation failure is non-fatal
      await expect(mod.disconnectGoogleAccount('acct-1')).resolves.toBeUndefined()
    })

    it('throws when the database delete fails', async () => {
      const mockDeleteEq = vi.fn().mockResolvedValue({
        error: { message: 'FK constraint' },
      })
      const mockSelectChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { access_token: 'at', refresh_token: 'rt' },
              error: null,
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }),
      }

      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue(mockSelectChain),
      })
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: true })

      const mod = await import('../oauth')
      await expect(mod.disconnectGoogleAccount('acct-1')).rejects.toThrow(
        'Failed to disconnect Google account'
      )
    })
  })

  // ── saveGoogleAccount ─────────────────────────────────────────────────

  describe('saveGoogleAccount()', () => {
    /** Builds a from('google_accounts') stub whose upsert arg is inspectable. */
    function makeGoogleAccountsChain(opts: {
      existingRefresh?: string
      accountId?: string
    }) {
      const upsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: opts.accountId ?? 'acct-9' },
            error: null,
          }),
        }),
      })
      const maybeSingle = vi.fn().mockResolvedValue({
        data: opts.existingRefresh
          ? { refresh_token: opts.existingRefresh }
          : null,
        error: null,
      })
      const select = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
      })
      return { upsert, select }
    }

    it('encrypts both tokens before the upsert — no plaintext reaches the DB', async () => {
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      const ga = makeGoogleAccountsChain({})
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) =>
          table === 'google_accounts' ? ga : {}
        ),
      })
      // Calendar-list fetch fails → the calendars upsert loop is skipped.
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: false, status: 500 })

      const mod = await import('../oauth')
      const { isEncrypted, decryptToken } = await import('../../crypto')

      const accountId = await mod.saveGoogleAccount('user-1', {
        access_token: 'at_plaintext',
        refresh_token: 'rt_plaintext',
        expires_in: 3600,
        email: 'user@example.com',
      })

      expect(accountId).toBe('acct-9')

      const payload = ga.upsert.mock.calls[0]![0]
      // Ciphertext, not plaintext.
      expect(payload.access_token).not.toBe('at_plaintext')
      expect(payload.refresh_token).not.toBe('rt_plaintext')
      expect(isEncrypted(payload.access_token)).toBe(true)
      expect(isEncrypted(payload.refresh_token)).toBe(true)
      // …and it round-trips back to the originals.
      expect(decryptToken(payload.access_token)).toBe('at_plaintext')
      expect(decryptToken(payload.refresh_token)).toBe('rt_plaintext')
    })

    it('preserves the stored refresh_token when Google omits one', async () => {
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      const ga = makeGoogleAccountsChain({ existingRefresh: 'v1:EXISTING_CIPHERTEXT' })
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) =>
          table === 'google_accounts' ? ga : {}
        ),
      })
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: false, status: 500 })

      const mod = await import('../oauth')
      const { isEncrypted, decryptToken } = await import('../../crypto')

      await mod.saveGoogleAccount('user-1', {
        access_token: 'at_new',
        // no refresh_token
        expires_in: 3600,
        email: 'user@example.com',
      })

      const payload = ga.upsert.mock.calls[0]![0]
      // Existing ciphertext kept verbatim — not overwritten, not re-encrypted.
      expect(payload.refresh_token).toBe('v1:EXISTING_CIPHERTEXT')
      // The fresh access token is still encrypted.
      expect(isEncrypted(payload.access_token)).toBe(true)
      expect(decryptToken(payload.access_token)).toBe('at_new')
    })

    it('throws when no refresh_token is provided and none is stored', async () => {
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      const ga = makeGoogleAccountsChain({}) // maybeSingle → null
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockImplementation((table: string) =>
          table === 'google_accounts' ? ga : {}
        ),
      })

      const mod = await import('../oauth')

      await expect(
        mod.saveGoogleAccount('user-1', {
          access_token: 'at_new',
          expires_in: 3600,
          email: 'user@example.com',
        })
      ).rejects.toThrow('no refresh_token')

      // Never reached the upsert.
      expect(ga.upsert).not.toHaveBeenCalled()
    })
  })
})
