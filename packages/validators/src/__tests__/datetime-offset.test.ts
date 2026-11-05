import { describe, it, expect } from 'vitest'
import { createTaskSchema, updateTaskSchema, scheduleTaskSchema } from '../task'
import { createEventSchema, updateEventSchema } from '../event'
import { bookSlotSchema } from '../booking'

// Timestamps with a UTC offset ("2026-06-15T14:00:00-05:00", which the MCP's own tool docs
// suggest) used to be rejected with 422. Every instant is now accepted with Z or an offset and
// normalised to the same UTC form, so stored values compare and sort the same way.
const OFFSET = '2026-06-15T14:00:00-05:00'
const SAME_INSTANT = '2026-06-15T19:00:00.000Z'

describe('timestamps with an offset', () => {
  it('a task slot accepts an offset and normalises it to UTC', () => {
    const r = createTaskSchema.safeParse({ title: 'A', scheduled_start: OFFSET, scheduled_end: '2026-06-15T15:30:00-05:00' })
    expect(r.success).toBe(true)
    expect(r.data?.scheduled_start).toBe(SAME_INSTANT)
    expect(r.data?.scheduled_end).toBe('2026-06-15T20:30:00.000Z')
  })

  it('Z is still accepted and comes out in the same form', () => {
    const r = createTaskSchema.safeParse({ title: 'A', scheduled_start: '2026-06-15T19:00:00Z' })
    expect(r.data?.scheduled_start).toBe(SAME_INSTANT)
  })

  it('a timestamp with no zone at all is still rejected', () => {
    expect(createTaskSchema.safeParse({ title: 'A', scheduled_start: '2026-06-15T14:00:00' }).success).toBe(false)
  })

  it('task updates, schedules and completed_at accept offsets', () => {
    expect(updateTaskSchema.safeParse({ scheduled_start: OFFSET }).data?.scheduled_start).toBe(SAME_INSTANT)
    expect(updateTaskSchema.safeParse({ completed_at: OFFSET }).data?.completed_at).toBe(SAME_INSTANT)
    const s = scheduleTaskSchema.safeParse({ scheduled_start: OFFSET, scheduled_end: '2026-06-15T15:00:00+02:00' })
    expect(s.success).toBe(true)
    expect(s.data?.scheduled_end).toBe('2026-06-15T13:00:00.000Z')
  })

  it('events accept offsets on start, end and occurrence fields', () => {
    const e = createEventSchema.safeParse({ title: 'Call', calendar_id: '00000000-0000-4000-8000-000000000001', start_time: OFFSET, end_time: '2026-06-15T15:00:00-05:00' })
    expect(e.success).toBe(true)
    expect(e.data?.start_time).toBe(SAME_INSTANT)
    const u = updateEventSchema.safeParse({ start_time: OFFSET, occurrence_start: OFFSET, scope_dates: [OFFSET] })
    expect(u.success).toBe(true)
    expect(u.data?.occurrence_start).toBe(SAME_INSTANT)
    expect(u.data?.scope_dates).toEqual([SAME_INSTANT])
  })

  it('a booking slot accepts an offset', () => {
    const b = bookSlotSchema.safeParse({ booker_name: 'Sam', booker_email: 'sam@example.com', start_time: OFFSET })
    expect(b.success).toBe(true)
    expect(b.data?.start_time).toBe(SAME_INSTANT)
  })
})
