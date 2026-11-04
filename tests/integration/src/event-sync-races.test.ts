import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'

it('keeps a newer browser edit pending when an earlier push completes, and coalesces incoming creates', async () => {
  const user = await createUser('event-race')
  const db = serviceClient()
  try {
    const { data: account } = await db.from('google_accounts').insert({ user_id: user.id, email: 'fixture@example.test', access_token: 'fixture', refresh_token: 'fixture', token_expires_at: '2099-01-01T00:00:00Z' }).select().single().throwOnError()
    const { data: calendar } = await user.client.from('calendars').insert({ user_id: user.id, google_account_id: account!.id, google_calendar_id: 'primary', name: 'Fixture', color: '#123456', source: 'google' }).select().single().throwOnError()
    const { data: event } = await user.client.from('events').insert({ user_id: user.id, calendar_id: calendar!.id, title: 'Before', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'UTC', sync_status: 'pending_push' }).select().single().throwOnError()
    const prepared = await db.rpc('prepare_event_push', { p_id: event!.id })
    expect(prepared.error).toBeNull()
    expect(prepared.data.google_event_id).toMatch(/^me[0-9a-f]+$/)
    await user.client.from('events').update({ title: 'Latest local edit', sync_status: 'pending_push' }).eq('id', event!.id).throwOnError()
    const finished = await db.rpc('finish_event_push', { p_event: prepared.data, p_google: { id: prepared.data.google_event_id, etag: 'old-response' } })
    expect(finished.error).toBeNull()
    expect(finished.data).toMatchObject({ title: 'Latest local edit', sync_status: 'pending_push' })
    const incoming = { ...event, google_event_id: 'remote-race', title: 'Incoming' }
    const inserts = await Promise.all([db.rpc('insert_google_event_once', { p_event: incoming }), db.rpc('insert_google_event_once', { p_event: incoming })])
    expect(inserts.map(r => r.error)).toEqual([null, null])
    expect(inserts.map(r => r.data).sort()).toEqual(['created', 'updated'])
    await db.from('events').update({ retry_count: 5, next_retry_at: '2099-01-01T00:00:00Z' }).eq('id', event!.id).throwOnError()
    const edit = await user.client.from('events').update({ title: 'Fresh edit after failure', sync_status: 'pending_push' }).eq('id', event!.id).select('retry_count, next_retry_at').single().throwOnError()
    expect(edit.data).toEqual({ retry_count: 0, next_retry_at: null })
    const denied = await user.client.rpc('prepare_event_push', { p_id: event!.id })
    expect(denied.error?.code).toBe('42501')
    const { data: local } = await user.client.from('calendars').select('id').eq('source', 'local').limit(1).single().throwOnError()
    const moved = await user.client.from('events').update({ calendar_id: local!.id, sync_status: 'pending_push' }).eq('id', event!.id).select().single().throwOnError()
    expect(moved.data).toMatchObject({ google_event_id: null, sync_status: 'synced' })
    const cleanup = await db.from('google_event_tombstones').select('*').eq('user_id', user.id).throwOnError()
    expect(cleanup.data).toHaveLength(1)
    expect(cleanup.data![0]).toMatchObject({ google_calendar_id: 'primary', google_event_id: prepared.data.google_event_id })
    // The worker can consume cleanup before the slow old-calendar create returns.
    await db.from('google_event_tombstones').delete().eq('user_id', user.id).throwOnError()
    const late = await db.rpc('finish_event_push', { p_event: prepared.data, p_google: { id: prepared.data.google_event_id, etag: 'late' } }).throwOnError()
    expect(late.data).toMatchObject({ calendar_id: local!.id, google_event_id: null, sync_status: 'synced', title: 'Fresh edit after failure' })
    expect((await db.from('google_event_tombstones').select('*').eq('user_id', user.id).throwOnError()).data).toHaveLength(1)
  } finally { await db.auth.admin.deleteUser(user.id) }
})
