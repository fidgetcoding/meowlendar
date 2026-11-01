import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import type { AuthResult } from '../helpers'

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockSupabaseClient = {
  auth: { getUser: mockGetUser },
  from: vi.fn(),
}

const mockScopedClient = { from: vi.fn(), __scoped: true }

vi.mock('../api-key', () => ({
  authenticateApiKey: vi.fn(),
}))

vi.mock('../../supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabaseClient),
}))

vi.mock('../user-jwt', () => ({
  mintUserJwt: vi.fn(async () => 'fake.jwt.token'),
  createUserScopedClient: vi.fn(() => mockScopedClient),
}))

vi.mock('../../rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => true),
}))

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('auth helpers', () => {
  let authenticate: typeof import('../helpers').authenticate
  let isAuthError: typeof import('../helpers').isAuthError
  let validationError: typeof import('../helpers').validationError
  let authenticateApiKey: Mock
  let mintUserJwt: Mock
  let createUserScopedClient: Mock
  let rateLimitAsync: Mock

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
    process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret'

    const helpers = await import('../helpers')
    authenticate = helpers.authenticate
    isAuthError = helpers.isAuthError
    validationError = helpers.validationError

    authenticateApiKey = (await import('../api-key')).authenticateApiKey as unknown as Mock
    const userJwt = await import('../user-jwt')
    mintUserJwt = userJwt.mintUserJwt as unknown as Mock
    createUserScopedClient = userJwt.createUserScopedClient as unknown as Mock
    rateLimitAsync = (await import('../../rate-limit')).rateLimitAsync as unknown as Mock

    // Re-establish default resolved values after resetAllMocks.
    mintUserJwt.mockResolvedValue('fake.jwt.token')
    createUserScopedClient.mockReturnValue(mockScopedClient)
    rateLimitAsync.mockResolvedValue(true)
  })

  // ── authenticate() — API key path ───────────────────────────────────────────

  describe('authenticate() API-key path', () => {
    it('mints a user-scoped JWT client (never the service role) for a valid key', async () => {
      authenticateApiKey.mockResolvedValue({ userId: 'user-from-apikey', keyId: 'key-1' })

      const request = new NextRequest('https://app.poolendar.com/api/events')
      const result = await authenticate(request)

      expect(result).not.toBeInstanceOf(NextResponse)
      const authResult = result as AuthResult
      expect(authResult.userId).toBe('user-from-apikey')
      // Client came from the user-scoped JWT path, not a service-role client.
      expect(mintUserJwt).toHaveBeenCalledWith('user-from-apikey')
      expect(createUserScopedClient).toHaveBeenCalledWith('fake.jwt.token')
      expect(authResult.supabase).toBe(mockScopedClient)
    })

    it('classifies GET as a read (1000/min) and POST as a write (100/min)', async () => {
      authenticateApiKey.mockResolvedValue({ userId: 'u1', keyId: 'key-9' })

      await authenticate(new NextRequest('https://app.poolendar.com/api/events', { method: 'GET' }))
      expect(rateLimitAsync).toHaveBeenCalledWith('apikey:read:key-9', 1000, 60_000)

      await authenticate(new NextRequest('https://app.poolendar.com/api/events', { method: 'POST' }))
      expect(rateLimitAsync).toHaveBeenCalledWith('apikey:write:key-9', 100, 60_000)
    })

    it('returns 429 with Retry-After when the key is over its budget', async () => {
      authenticateApiKey.mockResolvedValue({ userId: 'u1', keyId: 'key-2' })
      rateLimitAsync.mockResolvedValue(false)

      const request = new NextRequest('https://app.poolendar.com/api/events', { method: 'POST' })
      const result = await authenticate(request)

      expect(result).toBeInstanceOf(NextResponse)
      const res = result as NextResponse
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('60')
      // A rate-limited request must not mint a token or build a client.
      expect(mintUserJwt).not.toHaveBeenCalled()
      expect(createUserScopedClient).not.toHaveBeenCalled()
    })
  })

  // ── authenticate() — session path ─────────────────────────────────────────

  describe('authenticate() session path', () => {
    it('returns userId + supabase client for valid session', async () => {
      authenticateApiKey.mockResolvedValue(null)
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'session-user-id' } },
        error: null,
      })

      const request = new NextRequest('https://app.poolendar.com/api/events')
      const result = await authenticate(request)

      expect(result).not.toBeInstanceOf(NextResponse)
      const authResult = result as AuthResult
      expect(authResult.userId).toBe('session-user-id')
      // Session callers are never rate-limited.
      expect(rateLimitAsync).not.toHaveBeenCalled()
    })

    it('returns 401 NextResponse when neither API key nor session is valid', async () => {
      authenticateApiKey.mockResolvedValue(null)
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      })

      const request = new NextRequest('https://app.poolendar.com/api/events')
      const result = await authenticate(request)

      expect(result).toBeInstanceOf(NextResponse)
      const res = result as NextResponse
      expect(res.status).toBe(401)

      const body = await res.json()
      expect(body).toEqual({ error: 'Unauthorized' })
    })

    it('tries API key auth before session auth', async () => {
      authenticateApiKey.mockResolvedValue({ userId: 'api-key-user', keyId: 'key-3' })

      const request = new NextRequest('https://app.poolendar.com/api/events')
      await authenticate(request)

      // getUser should NOT be called because API key auth succeeded first
      expect(mockGetUser).not.toHaveBeenCalled()
    })
  })

  // ── isAuthError() ─────────────────────────────────────────────────────────

  describe('isAuthError()', () => {
    it('returns true for NextResponse', () => {
      const response = NextResponse.json({ error: 'nope' }, { status: 401 })
      expect(isAuthError(response)).toBe(true)
    })

    it('returns false for AuthResult object', () => {
      const authResult = { userId: 'abc', supabase: {} as AuthResult['supabase'] }
      expect(isAuthError(authResult)).toBe(false)
    })
  })

  // ── validationError() ─────────────────────────────────────────────────────

  describe('validationError()', () => {
    it('formats Zod issues into a structured 422 response', async () => {
      const issues = [
        { path: ['title'], message: 'Required' },
        { path: ['start_time'], message: 'Invalid date' },
        { path: ['start_time'], message: 'Must be in the future' },
      ]

      const response = validationError(issues)

      expect(response).toBeInstanceOf(NextResponse)
      // Spec #77: Zod validation failures are 422, not 400.
      expect(response.status).toBe(422)

      const body = await response.json()
      expect(body.error).toBe('Validation error')
      expect(body.details).toEqual({
        title: ['Required'],
        start_time: ['Invalid date', 'Must be in the future'],
      })
    })

    it('uses _root key for issues with empty path', async () => {
      const issues = [{ path: [], message: 'Invalid input' }]
      const response = validationError(issues)
      const body = await response.json()

      expect(body.details).toEqual({ _root: ['Invalid input'] })
    })

    it('joins nested paths with dots', async () => {
      const issues = [
        { path: ['attendees', 0, 'email'], message: 'Invalid email' },
      ]
      const response = validationError(issues)
      const body = await response.json()

      expect(body.details).toEqual({ 'attendees.0.email': ['Invalid email'] })
    })
  })
})
