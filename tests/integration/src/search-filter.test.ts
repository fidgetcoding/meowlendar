import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'
it('filters attendee text on the database while preserving event RLS', async () => {
  const owner = await createUser('search-filter-owner')
  const other = await createUser('search-filter-other')
  const db = serviceClient()
  try {
    const ids: string[] = []
    for (const user of [owner, other]) {
      const { data: calendar } = await user.client.from('calendars').select('id').limit(1).single().throwOnError()
      const { data: event } = await user.client.from('events').insert({ user_id: user.id, calendar_id: calendar!.id, title: 'Fixture', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'UTC', attendees: [{ email: 'needle@example.test' }] }).select('id').single().throwOnError()
      ids.push(event!.id)
    }
    const result = await owner.client.from('events').select('id').ilike('attendee_search_text', '%needle%')
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{ id: ids[0] }])
  } finally { await db.auth.admin.deleteUser(owner.id); await db.auth.admin.deleteUser(other.id) }
})
