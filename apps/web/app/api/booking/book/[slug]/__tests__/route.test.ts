import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { createBookingGoogleEvent } from '@/lib/booking/google-event'

const { link, writes, state, events } = vi.hoisted(() => ({
  link: { id: 'link', user_id: 'host', profiles: { username: 'host' }, duration_minutes: 120, minimum_notice_hours: 0, timezone: 'UTC', buffer_minutes: 0, google_account_id: null, requires_approval: true, availability: [{ day: 'monday', start: '13:00', end: '17:00' }] },
  writes: [] as unknown[],
  state: { insertError: null as null | { code: string } },
  events: [] as Record<string, unknown>[],
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: async () => true }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '127.0.0.1' }))
vi.mock('@/lib/hosts', () => ({ classifyHost: () => ({ kind: 'app' }) }))
vi.mock('@/lib/google/freebusy', () => ({ getGoogleBusyPeriods: async () => [] }))
vi.mock('@/lib/booking/google-event', () => ({ createBookingGoogleEvent: vi.fn() }))
vi.mock('@/lib/booking/notify', () => ({ sendBookingConfirmationEmail: vi.fn(), notifyHostOfBooking: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: (table: string) => {
  const query: Record<string, unknown> = {}
  let inserted: Record<string, unknown> | null = null
  for (const method of ['select', 'eq', 'neq', 'in', 'lt', 'gt', 'or', 'limit', 'order']) query[method] = () => query
  query.insert = (value: Record<string, unknown>) => { inserted = value; writes.push(value); return query }
  query.single = async () => ({ data: inserted ? (state.insertError ? null : { ...inserted, id: 'fixture-booking' }) : link, error: inserted ? state.insertError : null })
  let offset = 0
  query.range = (from: number) => { offset = from; return query }
  query.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: offset !== 0 ? [] : table === 'booking_links' ? [{ id: 'link', buffer_minutes: 0 }] : table === 'events' ? events : [], error: null }).then(resolve)
  return query
} }) }))
it('rejects a late-night booking whose next-day end appears inside afternoon hours', async () => {
  const request = new NextRequest('http://localhost/api/booking/book/fixture', { method: 'POST', body: JSON.stringify({ booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: '2030-01-07T23:00:00Z' }) })
  const response = await POST(request, { params: Promise.resolve({ slug: 'fixture' }) })
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'Selected time slot is outside available hours' })
  expect(writes).toEqual([])
})

beforeEach(() => { writes.length = 0; events.length = 0; state.insertError = null; vi.clearAllMocks(); link.requires_approval = true })
it('never creates a Google event when the booking reservation loses a race', async () => {
  link.requires_approval = false
  state.insertError = { code: '23P01' }
  const request = new NextRequest('http://localhost/api/booking/book/fixture', { method: 'POST', body: JSON.stringify({ booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: '2030-01-07T14:00:00Z' }) })
  const response = await POST(request, { params: Promise.resolve({ slug: 'fixture' }) })
  expect(response.status).toBe(409)
  expect(createBookingGoogleEvent).not.toHaveBeenCalled()
})

// The availability route offers a slot under a Free event, so booking it must go through too.
async function book(start: string) {
  const request = new NextRequest('http://localhost/api/booking/book/fixture', { method: 'POST', body: JSON.stringify({ booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: start }) })
  return POST(request, { params: Promise.resolve({ slug: 'fixture' }) })
}
const sameDay = (visibility: string, isAllDay: boolean) => isAllDay
  ? { start_time: '2030-01-07T00:00:00Z', end_time: '2030-01-08T00:00:00Z', timezone: 'UTC', is_all_day: true, visibility, recurrence_rule: null }
  : { start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'UTC', is_all_day: false, visibility, recurrence_rule: null }

it.each([[true], [false]])('books over a Free event (all-day: %s)', async (isAllDay) => {
  events.push(sameDay('free', isAllDay))
  expect((await book('2030-01-07T14:00:00Z')).status).toBe(201)
  expect(writes).toHaveLength(1)
})

it.each([[true], [false]])('refuses a time a Busy event holds (all-day: %s)', async (isAllDay) => {
  events.push(sameDay('busy', isAllDay))
  const response = await book('2030-01-07T14:00:00Z')
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'Selected time slot is no longer available' })
  expect(writes).toEqual([])
})
