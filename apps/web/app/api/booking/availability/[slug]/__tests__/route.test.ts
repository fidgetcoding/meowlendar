// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
const { events } = vi.hoisted(() => ({ events: [] as Record<string, unknown>[] }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => true }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '127.0.0.1' }))
vi.mock('@/lib/hosts', () => ({ classifyHost: () => ({ kind: 'app' }) }))
vi.mock('@/lib/google/freebusy', () => ({ getGoogleBusyPeriods: async () => [] }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: (table: string) => {
  const query: Record<string, unknown> = {}; let offset = 0
  for (const method of ['select', 'eq', 'neq', 'in', 'lt', 'gt', 'or', 'limit', 'order']) query[method] = () => query
  query.range = (from: number) => { offset = from; return query }
  query.single = async () => ({ data: { id: 'link', user_id: 'host', profiles: { username: 'host' }, duration_minutes: 30, minimum_notice_hours: 0, timezone: 'Asia/Tokyo', buffer_minutes: 0, google_account_id: null, availability: [{ day: 'monday', start: '09:00', end: '10:00' }] }, error: null })
  query.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: offset !== 0 ? [] : table === 'booking_links' ? [{ id: 'link', buffer_minutes: 0 }] : table === 'events' ? events : [], error: null }).then(resolve)
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

beforeEach(() => { events.length = 0 })

// Monday 09:00 to 10:00 in Tokyo is 00:00 to 01:00 UTC, two 30-minute slots.
const MONDAY = 'http://localhost/api/booking/availability/fixture?date=2030-01-07&timezone=Asia/Tokyo'
async function slotStarts() {
  const response = await GET(new NextRequest(MONDAY), { params: Promise.resolve({ slug: 'fixture' }) })
  expect(response.status).toBe(200)
  return ((await response.json()).slots as { start: string }[]).map((s) => s.start)
}
const allDay = (visibility: string) => ({ start_time: '2030-01-06T15:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'Asia/Tokyo', is_all_day: true, visibility, recurrence_rule: null })
const timed = (visibility: string | null) => ({ start_time: '2030-01-07T00:00:00Z', end_time: '2030-01-07T00:30:00Z', timezone: 'Asia/Tokyo', is_all_day: false, visibility, recurrence_rule: null })

it('keeps every slot open on a day with a Free all-day event', async () => {
  events.push(allDay('free'))
  expect(await slotStarts()).toEqual(['2030-01-07T00:00:00.000Z', '2030-01-07T00:30:00.000Z'])
})

it('keeps a slot open under a Free timed event', async () => {
  events.push(timed('free'))
  expect(await slotStarts()).toEqual(['2030-01-07T00:00:00.000Z', '2030-01-07T00:30:00.000Z'])
})

it('blocks the day for a Busy all-day event, and the slot under a Busy timed one', async () => {
  events.push(allDay('busy'))
  expect(await slotStarts()).toEqual([])
  events.length = 0
  events.push(timed('busy'))
  expect(await slotStarts()).toEqual(['2030-01-07T00:30:00.000Z'])
})

it('treats an event with no visibility as Busy', async () => {
  events.push(timed(null))
  expect(await slotStarts()).toEqual(['2030-01-07T00:30:00.000Z'])
})
