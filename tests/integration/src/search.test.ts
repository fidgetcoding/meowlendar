import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'

it('searches attendee email fragments without failing the combined search', async () => {
  const user = await createUser('attendee-search')
  try {
    const { data: calendar } = await user.client.from('calendars').select('id').limit(1).single().throwOnError()
    const { data: event } = await user.client.from('events').insert({ user_id: user.id, calendar_id: calendar!.id, title: 'Fixture meeting', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'UTC', attendees: [{ email: 'unique-attendee@example.test' }] }).select('id').single().throwOnError()
    const response = await user.api('/api/search?q=unique-attendee')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toEqual([expect.objectContaining({ id: event!.id, type: 'event', snippet: 'Attendee: unique-attendee@example.test' })])
  } finally { await serviceClient().auth.admin.deleteUser(user.id) }
})
