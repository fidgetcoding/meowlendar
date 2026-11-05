// @vitest-environment node
import { expect, it } from 'vitest'
import type { CalendarEvent, Routine, RoutineInstance } from '@poolendar/types'
import { eventsToItems, routinesToItems } from '../grid-items'

it.each(['America/New_York', 'Asia/Dubai'])('keeps all-day dates on the intended day in %s', (zone) => {
  const original = process.env.TZ
  process.env.TZ = zone
  try {
    for (const recurrence_rule of [null, 'FREQ=DAILY;COUNT=1']) {
      const event = { id: 'holiday', calendar_id: 'local', title: 'Holiday', status: 'confirmed', start_time: '2026-03-08T00:00:00.000Z', end_time: '2026-03-09T00:00:00.000Z', is_all_day: true, timezone: 'America/New_York', recurrence_rule } as CalendarEvent
      const items = eventsToItems([event], [], { start: new Date(2026, 2, 8), end: new Date(2026, 2, 8, 23, 59, 59, 999) })
      expect(items).toHaveLength(1)
      expect(items[0]!.startTime.getDate()).toBe(8)
      expect(items[0]!.startTime.getHours()).toBe(0)
      expect(items[0]!.endTime.getDate()).toBe(9)
      expect(items[0]!.endTime.getHours()).toBe(0)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

it('renders a Tokyo Monday routine on Sunday evening for a New York viewer', () => {
  const original = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const routine = { id: 'routine', title: 'Tokyo morning', timezone: 'Asia/Tokyo', start_time: '09:00:00', end_time: '10:00:00', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO', created_at: '2029-01-01T00:00:00Z' } as Routine
    const items = routinesToItems([routine], [new Date(2030, 0, 6)], [])
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('routine-2030-01-07')
    expect(items[0]!.startTime.toISOString()).toBe('2030-01-07T00:00:00.000Z')
    expect(items[0]!.startTime.getHours()).toBe(19)
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
})

it('restores saved completion on the routine host date after a reload', () => {
  const routine = { id: 'routine', title: 'Morning', timezone: 'UTC', start_time: '09:00', end_time: '10:00', recurrence_rule: 'FREQ=DAILY', created_at: '2029-01-01T00:00:00Z' } as Routine
  const saved = { routine_id: 'routine', date: '2030-01-07', status: 'completed' } as RoutineInstance
  const items = routinesToItems([routine], [new Date(2030, 0, 7)], [], [saved])
  expect(items.find(item => item.id === 'routine-2030-01-07')?.routineInstanceStatus).toBe('completed')
})

it('leaves a skipped routine occurrence off the grid, like an event exception', () => {
  // "Delete only this occurrence" skips the date; the occurrence must disappear, not linger.
  const routine = { id: 'routine', title: 'Morning', timezone: 'UTC', start_time: '09:00', end_time: '10:00', recurrence_rule: 'FREQ=DAILY', created_at: '2029-01-01T00:00:00Z' } as Routine
  const skipped = { routine_id: 'routine', date: '2030-01-07', status: 'skipped' } as RoutineInstance
  const items = routinesToItems([routine], [new Date(2030, 0, 7), new Date(2030, 0, 8)], [], [skipped])
  expect(items.map((item) => item.id)).toEqual(['routine-2030-01-08'])
})
