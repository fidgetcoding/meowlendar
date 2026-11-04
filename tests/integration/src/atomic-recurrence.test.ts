import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'

it('rolls back the master and every detached occurrence when a later insert fails', async () => {
  const user = await createUser('atomic-series')
  const db = serviceClient()
  try {
    const { data: calendar } = await user.client.from('calendars').select('id').limit(1).single().throwOnError()
    const { data: master } = await user.client.from('events').insert({ user_id: user.id, calendar_id: calendar!.id, title: 'Original', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'UTC', recurrence_rule: 'FREQ=DAILY' }).select().single().throwOnError()
    const child = { ...master, recurrence_id: master!.id, recurrence_rule: null, title: 'Detached' }
    const result = await user.client.rpc('mutate_event_series', { p_id: master!.id, p_expected_updated_at: master!.updated_at, p_patch: { recurrence_exceptions: ['2030-01-08T14:00:00Z'] }, p_inserts: [child, { ...child, title: null }] })
    expect(result.error?.code).toBe('23502')
    const { data: stored } = await user.client.from('events').select('title, recurrence_exceptions')
    expect(stored).toEqual([{ title: 'Original', recurrence_exceptions: [] }])
    const success = await user.client.rpc('mutate_event_series', { p_id: master!.id, p_expected_updated_at: master!.updated_at, p_patch: { recurrence_exceptions: ['2030-01-08T14:00:00Z'] }, p_inserts: [child] })
    expect(success.error).toBeNull()
    const stale = await user.client.rpc('mutate_event_series', { p_id: master!.id, p_expected_updated_at: master!.updated_at, p_patch: { title: 'Stale edit' } })
    expect(stale.error?.code).toBe('PT409')
  } finally { await db.auth.admin.deleteUser(user.id) }
})
