import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'

it('atomically reserves a host across different links under concurrent inserts', async () => {
  const user = await createUser('reservation-race')
  const db = serviceClient()
  try {
    const { data: links, error } = await user.client.from('booking_links').insert([0, 1].map(i => ({ user_id: user.id, name: `Link ${i}`, slug: `race-${user.id}-${i}`, duration_minutes: 30, timezone: 'UTC', availability: [] }))).select('id')
    expect(error).toBeNull()
    const results = await Promise.all(links!.map(link => db.from('bookings').insert({ booking_link_id: link.id, booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T14:30:00Z', status: 'confirmed' }).select('id')))
    expect(results.filter(r => !r.error)).toHaveLength(1)
    expect(results.find(r => r.error)?.error?.code).toBe('23P01')
  } finally { await db.auth.admin.deleteUser(user.id) }
})

it('enforces both links buffers, rolls back conflicting reschedules, and releases cancelled reservations', async () => {
  const user = await createUser('reservation-buffers')
  const db = serviceClient()
  try {
    const { data: links } = await user.client.from('booking_links').insert([0, 1].map(i => ({ user_id: user.id, name: `Buffer ${i}`, slug: `buffer-${user.id}-${i}`, duration_minutes: 30, timezone: 'UTC', availability: [], buffer_minutes: 10 }))).select('id').throwOnError()
    const insert = (index: number, start: string, end: string) => db.from('bookings').insert({ booking_link_id: links![index]!.id, booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: start, end_time: end, status: 'pending' }).select().single()
    const first = await insert(0, '2030-01-07T14:00:00Z', '2030-01-07T14:30:00Z')
    expect(first.error).toBeNull()
    expect((await insert(1, '2030-01-07T14:49:00Z', '2030-01-07T15:19:00Z')).error?.code).toBe('23P01')
    const second = await insert(1, '2030-01-07T14:50:00Z', '2030-01-07T15:20:00Z')
    expect(second.error).toBeNull()
    const conflict = await db.from('bookings').update({ start_time: '2030-01-07T14:15:00Z', end_time: '2030-01-07T14:45:00Z' }).eq('id', second.data!.id)
    expect(conflict.error?.code).toBe('23P01')
    const { data: unchanged } = await db.from('bookings').select('start_time').eq('id', second.data!.id).single()
    expect(new Date(unchanged!.start_time).toISOString()).toBe('2030-01-07T14:50:00.000Z')
    await db.from('bookings').update({ status: 'cancelled' }).eq('id', first.data!.id).throwOnError()
    expect((await insert(1, '2030-01-07T14:00:00Z', '2030-01-07T14:30:00Z')).error).toBeNull()
  } finally { await db.auth.admin.deleteUser(user.id) }
})
