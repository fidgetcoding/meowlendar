import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────────

// These tests cover the HTTP wrappers; crypto.test.ts covers token encryption.
vi.mock('../../crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../crypto')>()),
  decryptToken: (value: string) => value,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              access_token: 'mock-access-token',
              refresh_token: 'mock-refresh-token',
              // Set expiry well into the future so refreshTokenIfNeeded returns immediately
              token_expires_at: new Date(
                Date.now() + 3600 * 1000
              ).toISOString(),
            },
            error: null,
          }),
        }),
      }),
    }),
  })),
}))

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Google Calendar API wrappers', () => {
  let googleCalendarRequest: typeof import('../calendar').googleCalendarRequest
  let createGoogleEvent: typeof import('../calendar').createGoogleEvent
  let updateGoogleEvent: typeof import('../calendar').updateGoogleEvent
  let deleteGoogleEvent: typeof import('../calendar').deleteGoogleEvent
  let listGoogleEvents: typeof import('../calendar').listGoogleEvents
  let getGoogleAccessToken: typeof import('../calendar').getGoogleAccessToken

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    ;(globalThis.fetch as Mock).mockReset()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    process.env.GOOGLE_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
    process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')

    const mod = await import('../calendar')
    googleCalendarRequest = mod.googleCalendarRequest
    createGoogleEvent = mod.createGoogleEvent
    updateGoogleEvent = mod.updateGoogleEvent
    deleteGoogleEvent = mod.deleteGoogleEvent
    listGoogleEvents = mod.listGoogleEvents
    getGoogleAccessToken = mod.getGoogleAccessToken
  })

  // ── googleCalendarRequest ───────────────────────────────────────────────

  describe('googleCalendarRequest()', () => {
    it('sends GET request with Bearer auth header', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      })

      const result = await googleCalendarRequest(
        'test-token',
        '/calendars/primary/events'
      )

      expect(result).toEqual({ items: [] })
      const [url, opts] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toBe(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events'
      )
      expect(opts.headers.Authorization).toBe('Bearer test-token')
    })

    it('throws on non-OK response', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      })

      await expect(
        googleCalendarRequest('token', '/calendars/primary/events')
      ).rejects.toThrow('Google Calendar API error: 403')
    })

    it('returns null for 204 No Content', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      const result = await googleCalendarRequest('token', '/some/path')
      expect(result).toBeNull()
    })
  })

  // ── getGoogleAccessToken ───────────────────────────────────────────────

  describe('getGoogleAccessToken()', () => {
    it('returns the stored access token when not expired', async () => {
      const token = await getGoogleAccessToken('acct-1')
      expect(token).toBe('mock-access-token')
      // Should NOT have called fetch for token refresh
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('refreshes token when it is about to expire', async () => {
      // Re-mock with an about-to-expire token
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  access_token: 'old-token',
                  refresh_token: 'rt_refresh',
                  // Expires in 30 seconds (below 60s threshold)
                  token_expires_at: new Date(
                    Date.now() + 30 * 1000
                  ).toISOString(),
                },
                error: null,
              }),
            }),
          }),
          update: mockUpdate,
        }),
      })

      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          expires_in: 3600,
        }),
      })

      const mod = await import('../calendar')
      const token = await mod.getGoogleAccessToken('acct-1')

      expect(token).toBe('new-token')
      // Verify token refresh request
      const [url, opts] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toBe('https://oauth2.googleapis.com/token')
      const body = new URLSearchParams(opts.body)
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('rt_refresh')
    })

    it('throws when refresh request fails', async () => {
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  access_token: 'old',
                  refresh_token: 'rt',
                  token_expires_at: new Date(
                    Date.now() - 1000
                  ).toISOString(), // already expired
                },
                error: null,
              }),
            }),
          }),
        }),
      })

      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
      })

      const mod = await import('../calendar')
      await expect(mod.getGoogleAccessToken('acct-1')).rejects.toThrow(
        'Failed to refresh Google token'
      )
    })

    it('throws when account is not found in DB', async () => {
      vi.resetModules()
      const { createServerClient } = await import('@supabase/ssr')
      ;(createServerClient as unknown as Mock).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'not found' },
              }),
            }),
          }),
        }),
      })

      const mod = await import('../calendar')
      await expect(mod.getGoogleAccessToken('missing')).rejects.toThrow(
        'Google account not found'
      )
    })
  })

  // ── createGoogleEvent ──────────────────────────────────────────────────

  describe('createGoogleEvent()', () => {
    it('sends POST request with event payload', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'google-event-1',
          etag: '"etag-abc"',
        }),
      })

      const event = {
        summary: 'Team standup',
        start: { dateTime: '2026-06-15T09:00:00-04:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-06-15T09:30:00-04:00', timeZone: 'America/New_York' },
      }

      const result = await createGoogleEvent('acct-1', 'primary', event)

      expect(result).toEqual({ id: 'google-event-1', etag: '"etag-abc"' })

      const [url, opts] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toContain('/calendars/primary/events')
      expect(opts.method).toBe('POST')
      const body = JSON.parse(opts.body)
      expect(body.summary).toBe('Team standup')
    })

    it('appends conferenceDataVersion=1 when conferencing is true', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'e1', etag: '"e"' }),
      })

      const event = {
        summary: 'Meeting',
        start: { dateTime: '2026-06-15T10:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-06-15T11:00:00Z', timeZone: 'UTC' },
      }

      await createGoogleEvent('acct-1', 'primary', event, true)

      const [url, opts] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toContain('conferenceDataVersion=1')
      // conferenceData should be auto-added to the payload
      const body = JSON.parse(opts.body)
      expect(body.conferenceData).toBeDefined()
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
        'hangoutsMeet'
      )
    })
  })

  // ── updateGoogleEvent ──────────────────────────────────────────────────

  describe('updateGoogleEvent()', () => {
    it('sends PATCH request to the correct event URL', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'evt-1', etag: '"new-etag"' }),
      })

      const result = await updateGoogleEvent('acct-1', 'cal-1', 'evt-1', {
        summary: 'Updated title',
      })

      expect(result).toEqual({ id: 'evt-1', etag: '"new-etag"' })

      const [url, opts] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toContain('/calendars/cal-1/events/evt-1')
      expect(opts.method).toBe('PATCH')
    })
  })

  // ── deleteGoogleEvent ──────────────────────────────────────────────────

  describe('deleteGoogleEvent()', () => {
    it('sends DELETE request', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
      })

      await deleteGoogleEvent('acct-1', 'cal-1', 'evt-1')

      const [url, opts] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toContain('/calendars/cal-1/events/evt-1')
      expect(opts.method).toBe('DELETE')
    })

    it('handles 404 gracefully (event already deleted)', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      // Should NOT throw
      await expect(
        deleteGoogleEvent('acct-1', 'cal-1', 'already-gone')
      ).resolves.toBeUndefined()
    })

    it('handles 410 Gone gracefully', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 410,
      })

      await expect(
        deleteGoogleEvent('acct-1', 'cal-1', 'gone-event')
      ).resolves.toBeUndefined()
    })

    it('throws on unexpected error status', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      await expect(
        deleteGoogleEvent('acct-1', 'cal-1', 'evt-1')
      ).rejects.toThrow('Google Calendar delete failed: 500')
    })
  })

  // ── listGoogleEvents ──────────────────────────────────────────────────

  describe('listGoogleEvents()', () => {
    it('returns events with sync token support', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'e1' }, { id: 'e2' }],
          nextSyncToken: 'sync-token-abc',
        }),
      })

      const result = await listGoogleEvents('acct-1', 'primary', {
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-30T23:59:59Z',
      })

      expect(result.items).toHaveLength(2)
      expect(result.nextSyncToken).toBe('sync-token-abc')

      const [url] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toContain('timeMin=')
      expect(url).toContain('timeMax=')
      expect(url).toContain('maxResults=250')
    })

    it('passes syncToken as query parameter for incremental sync', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], nextSyncToken: 'new-token' }),
      })

      await listGoogleEvents('acct-1', 'primary', {
        syncToken: 'existing-sync-token',
      })

      const [url] = (globalThis.fetch as Mock).mock.calls[0]!
      expect(url).toContain('syncToken=existing-sync-token')
    })
  })
})
