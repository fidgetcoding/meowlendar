import { beforeEach, expect, it, vi } from 'vitest'
import { applyIncomingTaskEvent, googleEventIdForTask, TASK_ID_PROPERTY } from '../task-sync'
import type { SupabaseClient } from '@supabase/supabase-js'

const row = { google_calendar_id: 'current-calendar', id: 'task', google_event_id: 'remote', google_dirty: true, google_etag: 'old', updated_at: '2026-01-01T00:00:00Z' }
const write = vi.fn()
const read = vi.fn()
const client = { from: () => {
  const query: Record<string, unknown> = {}
  query.select = query.eq = () => query
  query.maybeSingle = read
  query.update = (value: unknown) => { write(value); return query }
  query.then = (resolve: (value: unknown) => void) => Promise.resolve({ error: null }).then(resolve)
  return query
} } as unknown as SupabaseClient
beforeEach(() => {
  write.mockClear()
  read.mockResolvedValue({ data: row, error: null })
})
it('keeps a pending local task edit when Google reports deletion', async () => {
  await applyIncomingTaskEvent(client, { id: 'remote', status: 'cancelled', extendedProperties: { private: { [TASK_ID_PROPERTY]: 'task' } } }, 'user', 'current-calendar')
  expect(write).not.toHaveBeenCalled()
})

it('fails an incoming task sync when its database lookup fails', async () => {
  read.mockResolvedValue({ data: null, error: { message: 'fixture task read failed' } })
  await expect(applyIncomingTaskEvent(client, { id: 'remote', extendedProperties: { private: { [TASK_ID_PROPERTY]: 'task' } } }, 'user', 'current-calendar')).rejects.toThrow('fixture task read failed')
})

it('ignores deletion of an old mirror after the task moves to another calendar', async () => {
  read.mockResolvedValue({ data: { ...row, google_dirty: false, google_calendar_id: 'new-calendar' }, error: null })
  await applyIncomingTaskEvent(client, { id: 'remote', status: 'cancelled', extendedProperties: { private: { [TASK_ID_PROPERTY]: 'task' } } }, 'user', 'old-calendar')
  expect(write).not.toHaveBeenCalled()
})

it('knows a mirror by the id we gave it when the private property is withheld', async () => {
  const taskId = '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b'
  const mirrorId = googleEventIdForTask(taskId)
  read.mockResolvedValue({ data: { ...row, id: taskId, google_dirty: false, google_event_id: mirrorId, google_calendar_id: 'owner-calendar' }, error: null })
  // Seen through a second account that shares the calendar.
  expect(await applyIncomingTaskEvent(client, { id: mirrorId, summary: 'Write report' }, 'user', 'shared-copy')).toBe('updated')
  expect(write).not.toHaveBeenCalled()
})

it('leaves an event alone when its id only looks like a mirror', async () => {
  read.mockResolvedValue({ data: null, error: null })
  expect(await applyIncomingTaskEvent(client, { id: googleEventIdForTask('0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b') }, 'user', 'calendar')).toBe(false)
})
