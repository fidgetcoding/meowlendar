// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

const { user } = vi.hoisted(() => ({ user: { current: { id: 'u1' } as { id: string } | null } }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: unknown[]) => void } }) => ({
    auth: { getUser: async () => {
      options.cookies.setAll([{ name: 'sb-session', value: 'refreshed', options: { httpOnly: true, path: '/' } }])
      return { data: { user: user.current }, error: null }
    } },
  }),
}))
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:4391'
  user.current = { id: 'u1' }
})

it('returns refreshed session cookies on a protected page', async () => {
  const request = new NextRequest('http://localhost:4391/', { headers: { host: 'localhost:4391' } })
  const response = await middleware(request)
  expect(response.cookies.get('sb-session')?.value).toBe('refreshed')
})

it('redirects a signed-in login visit with its refreshed cookies', async () => {
  const request = new NextRequest('http://localhost:4391/login', { headers: { host: 'localhost:4391' } })
  const response = await middleware(request)
  expect(response.headers.get('location')).toBe('http://localhost:4391/')
  expect(response.cookies.get('sb-session')?.value).toBe('refreshed')
})
