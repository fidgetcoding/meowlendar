import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

vi.mock('@/lib/env', () => ({ optionalEnv: vi.fn() }))

vi.mock('@/lib/google/state', () => ({
  signOAuthState: vi.fn(() => ({ state: 'signed-state-abc', nonce: 'nonce-1' })),
}))

vi.mock('@/lib/google/oauth', () => ({
  getGoogleOAuthUrl: vi.fn(
    (state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`
  ),
}))

import { POST } from '../route'
import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'
import { optionalEnv } from '@/lib/env'
import { getGoogleOAuthUrl } from '@/lib/google/oauth'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'

function req(): NextRequest {
  return new NextRequest(new URL('/api/calendars/connect', 'http://localhost:3000'), {
    method: 'POST',
  })
}

describe('POST /api/calendars/connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticate).mockResolvedValue({
      userId: TEST_USER_ID,
      supabase: {} as AuthResult['supabase'],
    })
  })

  it('returns the Google OAuth URL as JSON when configured', async () => {
    vi.mocked(optionalEnv).mockReturnValue('configured')

    const res = await POST(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.url).toContain('accounts.google.com')
    expect(body.url).toContain('signed-state-abc')
    expect(getGoogleOAuthUrl).toHaveBeenCalled()
  })

  it('returns 503 when Google OAuth is not configured', async () => {
    vi.mocked(optionalEnv).mockReturnValue(undefined)

    const res = await POST(req())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toContain('not configured')
    expect(getGoogleOAuthUrl).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(req())
    expect(res.status).toBe(401)
  })
})
