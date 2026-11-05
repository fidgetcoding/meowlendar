import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { exchange, getUser, from } = vi.hoisted(() => ({ exchange: vi.fn(), getUser: vi.fn(), from: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { exchangeCodeForSession: exchange, getUser }, from }) }))
vi.mock('@/lib/env', () => ({ optionalEnv: () => 'configured' }))
import { GET } from '../route'

beforeEach(() => {
  vi.clearAllMocks()
  exchange.mockResolvedValue({ error: null })
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  from.mockImplementation((table: string) => table === 'profiles'
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'user-1' } }) }) }) }
    : { select: () => ({ eq: async () => ({ count: 0 }) }) })
})

it('takes a first Google sign-in straight to calendar consent', async () => {
  const response = await GET(new NextRequest('http://localhost:3000/callback?code=test'))
  expect(response.headers.get('location')).toBe('http://localhost:3000/api/google/connect')
})
