import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'
it('keeps exact Google cleanup durable when a confirmed reservation is cancelled', async () => {
  const owner = await createUser('booking-cleanup')
  const db = serviceClient()
  try {
    const { data: account } = await db.from('google_accounts').insert({ user_id: owner.id, email: 'fixture@example.test', access_token: 'fixture', refresh_token: 'fixture', token_expires_at: '2099-01-01T00:00:00Z' }).select().single().throwOnError()
    const { data: link } = await owner.client.from('booking_links').insert({ user_id: owner.id, name: 'Fixture', slug: `cleanup-${owner.id}`, duration_minutes: 30, timezone: 'UTC', availability: [] }).select().single().throwOnError()
    const reservation = await db.from('bookings').insert({ booking_link_id: link!.id, booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T14:30:00Z', status: 'confirmed', google_event_id: 'mbfixture', google_account_id: account!.id, google_calendar_id: 'original-calendar' }).select().single()
    expect(reservation.error).toBeNull()
    await db.from('bookings').update({ status: 'cancelled' }).eq('id', reservation.data!.id).throwOnError()
    const { data: cleanup } = await db.from('google_event_tombstones').select('google_account_id, google_calendar_id, google_event_id').eq('user_id', owner.id)
    expect(cleanup).toEqual([{ google_account_id: account!.id, google_calendar_id: 'original-calendar', google_event_id: 'mbfixture' }])
  } finally { await db.auth.admin.deleteUser(owner.id) }
})

it('rejects changing a booking cleanup target to another owner account', async () => {
  const owner = await createUser('booking-target-owner')
  const other = await createUser('booking-target-other')
  const db = serviceClient()
  try {
    const { data: foreign } = await db.from('google_accounts').insert({ user_id: other.id, email: 'foreign@example.test', access_token: 'fixture', refresh_token: 'fixture', token_expires_at: '2099-01-01T00:00:00Z' }).select().single().throwOnError()
    const { data: link } = await owner.client.from('booking_links').insert({ user_id: owner.id, name: 'Fixture', slug: `target-${owner.id}`, duration_minutes: 30, timezone: 'UTC', availability: [] }).select().single().throwOnError()
    const { data: booking } = await db.from('bookings').insert({ booking_link_id: link!.id, booker_name: 'Fixture', booker_email: 'fixture@example.test', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T14:30:00Z', status: 'confirmed' }).select().single().throwOnError()
    const attempted = await owner.client.from('bookings').update({ google_account_id: foreign!.id, google_calendar_id: 'foreign-calendar', google_event_id: 'foreign-event' }).eq('id', booking!.id)
    expect(attempted.error?.code).toBe('23503')
    const { data: unchanged } = await db.from('bookings').select('google_account_id, google_calendar_id, google_event_id').eq('id', booking!.id).single().throwOnError()
    expect(unchanged).toEqual({ google_account_id: null, google_calendar_id: null, google_event_id: null })
  } finally { await db.auth.admin.deleteUser(owner.id); await db.auth.admin.deleteUser(other.id) }
})
