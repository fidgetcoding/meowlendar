import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { pullChanges, after, authenticate } = vi.hoisted(() => ({ pullChanges: vi.fn(), after: vi.fn(), authenticate: vi.fn() }))
vi.mock('next/server', async (importOriginal) => ({ ...await importOriginal<typeof import('next/server')>(), after }))
vi.mock('@/lib/auth/helpers', () => ({ authenticate, isAuthError: () => false }))
vi.mock('@/lib/google/state', () => ({ verifyOAuthState: () => ({ userId: 'user-1', nonce: 'nonce' }) }))
vi.mock('@/lib/google/oauth', () => ({ exchangeCodeForTokens: vi.fn().mockResolvedValue({}), saveGoogleAccount: vi.fn().mockResolvedValue('account-1') }))
vi.mock('@/lib/google/sync', () => ({ pullChanges }))
vi.mock('@/lib/google/webhooks', () => ({ registerAccountWebhook: vi.fn().mockResolvedValue(undefined) }))
import { GET } from '../route'

describe('Google connection callback', () => {
  beforeEach(() => { vi.clearAllMocks(); authenticate.mockResolvedValue({ userId: 'user-1' }) })
  it('starts syncing automatically before redirecting after Google consent', async () => {
    pullChanges.mockResolvedValue({ complete: true })
    const response = await GET(new NextRequest('http://localhost:3000/api/google/callback?code=test&state=test'))
    expect(pullChanges).toHaveBeenCalledWith('account-1', expect.objectContaining({ deadlineMs: expect.any(Number) }))
    expect(response.headers.get('location')).toContain('google_connected=true')
  })
  it('tells the app when the first automatic sync fails', async () => {
    pullChanges.mockRejectedValue(new Error('Calendar API disabled'))
    const response = await GET(new NextRequest('http://localhost:3000/api/google/callback?code=test&state=test'))
    expect(response.headers.get('location')).toContain('google_sync=failed')
  })
})
