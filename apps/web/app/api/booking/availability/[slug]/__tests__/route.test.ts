// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => true }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '127.0.0.1' }))
vi.mock('@/lib/hosts', () => ({ classifyHost: () => ({ kind: 'app' }) }))
vi.mock('@/lib/google/freebusy', () => ({ getGoogleBusyPeriods: async () => [] }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: (table: string) => {
  const query: Record<string, unknown> = {}; let offset = 0
  for (const method of ['select', 'eq', 'neq', 'in', 'lt', 'gt', 'or', 'limit', 'order']) query[method] = () => query
  query.range = (from: number) => { offset = from; return query }
  query.single = async () => ({ data: { id: 'link', user_id: 'host', profiles: { username: 'host' }, duration_minutes: 30, minimum_notice_hours: 0, timezone: 'Asia/Tokyo', buffer_minutes: 0, google_account_id: null, availability: [{ day: 'monday', start: '09:00', end: '10:00' }] }, error: null })
  query.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: table === 'booking_links' && offset === 0 ? [{ id: 'link', buffer_minutes: 0 }] : [], error: null }).then(resolve)
  return query
} }) }))
it('keeps host working hours when a visitor selects the preceding calendar day in New York', async () => {
  const response = await GET(new NextRequest('http://localhost/api/booking/availability/fixture?date=2030-01-06&timezone=America/New_York'), { params: Promise.resolve({ slug: 'fixture' }) })
  expect(response.status).toBe(200)
  expect((await response.json()).slots).toEqual([
    { start: '2030-01-07T00:00:00.000Z', end: '2030-01-07T00:30:00.000Z' },
    { start: '2030-01-07T00:30:00.000Z', end: '2030-01-07T01:00:00.000Z' },
  ])
})
