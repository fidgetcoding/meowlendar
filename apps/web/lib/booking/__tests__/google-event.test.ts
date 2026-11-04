import { expect, it, vi } from 'vitest'
import { createBookingGoogleEvent } from '../google-event'
import { createGoogleEvent, deleteGoogleEvent } from '../../google/calendar'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('../../google/calendar', () => ({ createGoogleEvent: vi.fn().mockResolvedValue({ id: 'remote' }), deleteGoogleEvent: vi.fn() }))
it('does not create an untracked Google event if persisting the reservation link fails', async () => {
  const client = { from: (table: string) => {
    const query: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'limit', 'update']) query[name] = () => query
    query.single = query.maybeSingle = async () => table === 'calendars' ? { data: { google_calendar_id: 'primary' }, error: null } : { data: null, error: { message: 'storage failure' } }
    return query
  } } as unknown as SupabaseClient
  await createBookingGoogleEvent(client, { user_id: 'user', google_account_id: 'account', conferencing: true, name: 'Meeting', location: null, timezone: 'UTC' }, { id: '00000000-0000-4000-8000-000000000001', booker_name: 'Fixture', booker_email: 'fixture@example.test', booker_notes: null, start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T14:30:00Z' })
  expect(createGoogleEvent).not.toHaveBeenCalled()
})

it('queues compensation if cancellation wins a race with Google creation and immediate deletion fails', async () => {
  vi.mocked(createGoogleEvent).mockClear()
  vi.mocked(deleteGoogleEvent).mockRejectedValueOnce(new Error('Google unavailable'))
  const writes: { table: string; data: Record<string, unknown> }[] = []
  const client = { from: (table: string) => {
    const query: Record<string, unknown> = {}; let updating = false
    for (const name of ['select', 'eq', 'limit']) query[name] = () => query
    query.update = (data: Record<string, unknown>) => { updating = true; writes.push({ table, data }); return query }
    query.insert = async (data: Record<string, unknown>) => { writes.push({ table, data }); return { error: null } }
    query.single = query.maybeSingle = async () => ({ error: null, data: table === 'calendars' ? { google_calendar_id: 'original' } : updating ? { id: 'reservation' } : { status: 'cancelled' } })
    return query
  } } as unknown as SupabaseClient
  const result = await createBookingGoogleEvent(client, { user_id: 'user', google_account_id: 'account', conferencing: true, name: 'Meeting', location: null, timezone: 'UTC' }, { id: '00000000-0000-4000-8000-000000000001', booker_name: 'Fixture', booker_email: 'fixture@example.test', booker_notes: null, start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T14:30:00Z' })
  expect(result).toBeNull()
  expect(createGoogleEvent).toHaveBeenCalledTimes(1)
  expect(writes[0]).toMatchObject({ table: 'bookings', data: { google_calendar_id: 'original', google_account_id: 'account' } })
  expect(writes[1]).toMatchObject({ table: 'google_event_tombstones', data: { google_calendar_id: 'original', google_account_id: 'account', google_event_id: 'mb00000000000040008000000000000001' } })
})
