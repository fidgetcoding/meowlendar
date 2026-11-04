import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'

it('returns and cursor-pages more than the Supabase row cap without losing tagged tasks or calendar events', async () => {
  const user = await createUser('scale-pages')
  const db = serviceClient()
  try {
    const { data: calendar } = await user.client.from('calendars').select('id').limit(1).single().throwOnError()
    const size = 1207
    await user.client.from('tasks').insert(Array.from({ length: size }, (_, i) => ({ user_id: user.id, title: `Task ${i}`, position: i, scheduled_start: '2030-01-07T14:00:00Z', scheduled_end: '2030-01-07T14:30:00Z' }))).throwOnError()
    const { data: last } = await user.client.from('tasks').select('id').eq('title', `Task ${size - 1}`).single().throwOnError()
    const { data: tag } = await user.client.from('tags').insert({ user_id: user.id, name: 'Last task', color: '#123456' }).select('id').single().throwOnError()
    await user.client.from('task_tags').insert({ task_id: last!.id, tag_id: tag!.id }).throwOnError()
    const all = await user.api('/api/tasks')
    expect(all.status).toBe(200)
    const body = await all.json() as { items: { id: string; tags: unknown[] }[] }
    expect(body.items).toHaveLength(size)
    expect(body.items.find(t => t.id === last!.id)?.tags).toHaveLength(1)
    const { data: secondTag } = await user.client.from('tags').insert({ user_id: user.id, name: 'Additional tag', color: '#654321' }).select('id').single().throwOnError()
    await user.client.from('task_tags').insert({ task_id: last!.id, tag_id: secondTag!.id }).throwOnError()
    const filtered = await user.api(`/api/tasks?tag_id=${tag!.id}`)
    const matching = await filtered.json()
    expect(filtered.status).toBe(200)
    expect(matching.items).toHaveLength(1)
    expect(matching.items[0].tags).toHaveLength(2)
    const search = await user.api('/api/search?types=task&q=Last%20task')
    expect(search.status).toBe(200)
    expect((await search.json()).items.map((item: { id: string }) => item.id)).toEqual([last!.id])
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const page = await user.api(`/api/tasks?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      expect(page.status).toBe(200)
      const result = await page.json() as { items: { id: string }[]; next_cursor: string | null }
      ids.push(...result.items.map(t => t.id)); cursor = result.next_cursor
      expect(ids.length).toBeLessThanOrEqual(size)
    } while (cursor)
    expect(new Set(ids).size).toBe(size)
    await user.client.from('events').insert(Array.from({ length: size }, (_, i) => ({ user_id: user.id, calendar_id: calendar!.id, title: `Event ${i}`, start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T14:30:00Z', timezone: 'UTC' }))).throwOnError()
    const events = await user.api('/api/events?start=2030-01-07T00:00:00Z&end=2030-01-08T00:00:00Z&include=events,tasks')
    expect(events.status).toBe(200)
    expect((await events.json()).items).toHaveLength(size * 2)
  } finally { await db.auth.admin.deleteUser(user.id) }
})


it('returns saved routine instances beyond the row cap and rejects excessive generated output', async () => {
  const user = await createUser('routine-scale')
  try {
    const { data: routine } = await user.client.from('routines').insert({ user_id: user.id, title: 'Routine scale', start_time: '09:00', end_time: '09:30', timezone: 'UTC', recurrence_rule: 'DTSTART:20300101T000000Z\nRRULE:FREQ=DAILY;COUNT=1' }).select('id').single().throwOnError()
    const rows = Array.from({ length: 1207 }, (_, i) => ({ routine_id: routine!.id, date: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10), status: 'completed' }))
    await user.client.from('routine_instances').insert(rows).throwOnError()
    const response = await user.api(`/api/routines/${routine!.id}/instances?start=2030-01-01&end=2035-01-01`)
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1207)
    await user.client.from('routines').update({ recurrence_rule: 'DTSTART:20300101T000000Z\nRRULE:FREQ=SECONDLY;COUNT=10001' }).eq('id', routine!.id).throwOnError()
    const overflow = await user.api(`/api/routines/${routine!.id}/instances?start=2030-01-01&end=2035-01-01`)
    expect(overflow.status).toBe(400)
    expect((await overflow.json()).error).toContain('smaller date range')
  } finally { await serviceClient().auth.admin.deleteUser(user.id) }
})
