import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), setSession: vi.fn(), getUser: vi.fn(), from: vi.fn(), cookieSet: vi.fn(), save: vi.fn(), pull: vi.fn(), userinfo: vi.fn(), after: vi.fn(), cookieMethods: { setAll: (...cookies: unknown[][]) => { void cookies } } }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: mocks.cookieSet }) }))
vi.mock('next/server', async (original) => ({ ...await original<typeof import('next/server')>(), after: mocks.after }))
vi.mock('@supabase/ssr', () => ({ createServerClient: (_url: string, _key: string, options: { cookies: typeof mocks.cookieMethods }) => { mocks.cookieMethods = options.cookies; return { auth: { exchangeCodeForSession: mocks.exchange, setSession: mocks.setSession, getUser: mocks.getUser }, from: mocks.from } } }))
vi.mock('@/lib/google/oauth', () => ({ saveGoogleAccount: mocks.save, getGoogleIdentity: mocks.userinfo }))
vi.mock('@/lib/google/sync', () => ({ pullChanges: mocks.pull }))
vi.mock('@/lib/google/webhooks', () => ({ registerAccountWebhook: vi.fn() }))
import { GET } from '../route'

const session = { access_token: 'supabase-access', refresh_token: 'supabase-refresh', provider_token: 'google-access-secret', provider_refresh_token: 'google-refresh-secret' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.exchange.mockImplementation(async () => { mocks.cookieMethods.setAll([{ name: 'sb-test-auth-token', value: 'google-refresh-secret', options: {} }]); return { data: { session }, error: null } })
  mocks.setSession.mockImplementation(async () => { mocks.cookieMethods.setAll([{ name: 'sb-test-auth-token', value: 'sanitized-session', options: {} }]); return { error: null } })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'nate@example.test', app_metadata: { provider: 'google' } } } })
  mocks.userinfo.mockResolvedValue({ email: 'nate@example.test', emailVerified: true })
  mocks.save.mockResolvedValue('account-1')
  mocks.pull.mockResolvedValue({ complete: true })
  mocks.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'user-1' } }) }) }) }))
})

it('uses the one Google consent for sign-in and calendar sync without putting provider tokens in cookies', async () => {
  const response = await GET(new NextRequest('http://localhost:3000/callback?code=test'))
  expect(mocks.userinfo).toHaveBeenCalledWith('google-access-secret')
  expect(mocks.save).toHaveBeenCalledWith('user-1', expect.objectContaining({ access_token: 'google-access-secret', refresh_token: 'google-refresh-secret', email: 'nate@example.test' }))
  expect(mocks.pull).toHaveBeenCalledWith('account-1', expect.anything())
  expect(mocks.cookieSet).toHaveBeenCalledWith('sb-test-auth-token', 'sanitized-session', expect.anything())
  expect(JSON.stringify(mocks.cookieSet.mock.calls)).not.toContain('google-refresh-secret')
  expect(response.headers.get('location')).toBe('http://localhost:3000/')
})

it('never attaches a Google account whose verified email differs from the signed-in user', async () => {
  mocks.userinfo.mockResolvedValue({ email: 'other@example.test', emailVerified: true })
  const response = await GET(new NextRequest('http://localhost:3000/callback?code=test'))
  expect(mocks.save).not.toHaveBeenCalled()
  expect(response.headers.get('location')).toContain('google_sync=failed')
})

it('never sends provider tokens to the browser if session sanitization fails', async () => {
  mocks.setSession.mockResolvedValue({ error: new Error('failed') })
  const response = await GET(new NextRequest('http://localhost:3000/callback?code=test'))
  expect(response.headers.get('location')).toContain('auth_callback_failed')
  expect(JSON.stringify(mocks.cookieSet.mock.calls)).not.toContain('google-refresh-secret')
  expect(mocks.save).not.toHaveBeenCalled()
})
