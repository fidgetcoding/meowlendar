import { describe, it, expect } from 'vitest'
import {
  isMultiDayItem,
  isAllDayRowItem,
  itemOverlapsDay,
  clampItemToDay,
  mergeDuplicateEventItems,
  isDeclinedEvent,
  filterWeekends,
  getVisibleDays,
} from '../grid-helpers'
import type { CalendarItemData } from '../calendar-types'
import type { CalendarEvent } from '@poolendar/types'

function item(overrides: Partial<CalendarItemData> = {}): CalendarItemData {
  return {
    id: 'i1',
    type: 'event',
    title: 'Meeting',
    startTime: new Date('2026-07-06T09:00:00'),
    endTime: new Date('2026-07-06T10:00:00'),
    color: '#3b82f6',
    ...overrides,
  }
}

describe('isMultiDayItem', () => {
  it('is false for a same-day timed item', () => {
    expect(isMultiDayItem(item())).toBe(false)
  })

  it('is true for an item crossing midnight', () => {
    expect(
      isMultiDayItem(
        item({
          startTime: new Date('2026-07-06T23:00:00'),
          endTime: new Date('2026-07-07T01:00:00'),
        })
      )
    ).toBe(true)
  })

  it('treats an event ending exactly at midnight as single-day', () => {
    expect(
      isMultiDayItem(
        item({
          startTime: new Date('2026-07-06T14:00:00'),
          endTime: new Date('2026-07-07T00:00:00'),
        })
      )
    ).toBe(false)
  })
})

describe('isAllDayRowItem', () => {
  it('routes all-day and multi-day items to the all-day row', () => {
    expect(isAllDayRowItem(item({ isAllDay: true }))).toBe(true)
    expect(
      isAllDayRowItem(
        item({
          startTime: new Date('2026-07-06T23:00:00'),
          endTime: new Date('2026-07-08T01:00:00'),
        })
      )
    ).toBe(true)
  })

  it('keeps a normal timed item out of the all-day row', () => {
    expect(isAllDayRowItem(item())).toBe(false)
  })
})

describe('clampItemToDay', () => {
  it('clamps a cross-midnight item to the target day bounds', () => {
    const src = item({
      startTime: new Date('2026-07-06T23:00:00'),
      endTime: new Date('2026-07-07T02:00:00'),
    })
    const clamped = clampItemToDay(src, new Date('2026-07-07T12:00:00'))
    expect(clamped.startTime.getHours()).toBe(0)
    expect(clamped.endTime.getHours()).toBe(2)
    // original is untouched
    expect(src.startTime.getHours()).toBe(23)
  })

  it('returns the same object when no clamping is needed', () => {
    const src = item()
    expect(clampItemToDay(src, new Date('2026-07-06T00:00:00'))).toBe(src)
  })
})

describe('itemOverlapsDay', () => {
  it('detects overlap and non-overlap', () => {
    expect(itemOverlapsDay(item(), new Date('2026-07-06T00:00:00'))).toBe(true)
    expect(itemOverlapsDay(item(), new Date('2026-07-07T00:00:00'))).toBe(false)
  })
})

describe('mergeDuplicateEventItems', () => {
  const on = (calendarId: string, extra: Partial<CalendarEvent> = {}) =>
    ({ calendar_id: calendarId, attendees: [], ...extra }) as CalendarEvent

  it('collapses identical events from different calendars but keeps distinct ones and non-events', () => {
    const a = item({ id: 'a', title: 'Standup', event: on('work') })
    const dup = item({ id: 'b', title: 'Standup', event: on('home') }) // same title + times
    const other = item({ id: 'c', title: 'Different', event: on('home') })
    const task = item({ id: 't', type: 'task', title: 'Standup' })

    const merged = mergeDuplicateEventItems([a, dup, other, task])
    const ids = merged.map((m) => m.id)
    expect(ids).toContain('a')
    expect(ids).not.toContain('b') // duplicate event dropped
    expect(ids).toContain('c')
    expect(ids).toContain('t') // task with same title is NOT merged
    expect(merged.find((m) => m.id === 'a')!.duplicates?.map((d) => d.id)).toEqual(['b'])
  })

  it('keeps two identical events on one calendar', () => {
    const merged = mergeDuplicateEventItems([item({ id: 'a', event: on('work') }), item({ id: 'b', event: on('work') })])
    expect(merged.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('merges copies with one iCalUID and start, whatever their titles', () => {
    const merged = mergeDuplicateEventItems([
      item({ id: 'a', title: 'Vendor call', event: on('work', { ical_uid: 'x@outlook.test' }) }),
      item({ id: 'b', title: 'Vendor call (Acme)', event: on('home', { ical_uid: 'x@outlook.test' }) }),
    ])
    expect(merged.map((m) => m.id)).toEqual(['a'])
  })

  it('shows the copy you accepted over one you have not answered', () => {
    const answer = (email: string, response_status: 'accepted' | 'needsAction') => [{ email, response_status, self: true }]
    const merged = mergeDuplicateEventItems([
      item({ id: 'a', event: on('home', { ical_uid: 'k', attendees: answer('home@x.test', 'needsAction') }) }),
      item({ id: 'b', event: on('work', { ical_uid: 'k', attendees: answer('work@x.test', 'accepted') }) }),
    ])
    expect(merged.map((m) => m.id)).toEqual(['b'])
  })
})

describe('isDeclinedEvent', () => {
  const base: CalendarEvent = {
    id: 'e1',
    user_id: 'u1',
    calendar_id: 'c1',
    google_event_id: null,
    title: 'Sync',
    notes: null,
    start_time: '2026-07-06T09:00:00Z',
    end_time: '2026-07-06T10:00:00Z',
    timezone: 'America/New_York',
    is_all_day: false,
    location: null,
    color_override: null,
    visibility: 'busy',
    privacy: 'public',
    conferencing_url: null,
    recurrence_rule: null,
    recurrence_id: null,
    attendees: [{ email: 'me@example.com', response_status: 'declined' }],
    reminders: [],
    status: 'confirmed',
    sync_status: 'synced',
    etag: null,
    created_at: '',
    updated_at: '',
  }

  it('is true when a self-email attendee declined', () => {
    expect(isDeclinedEvent(base, ['me@example.com'])).toBe(true)
  })

  it('is false without self-email context', () => {
    expect(isDeclinedEvent(base, [])).toBe(false)
  })

  it("goes by the copy's own account when Google marked it", () => {
    const answers = [
      { email: 'work@example.com', response_status: 'accepted' as const, self: true },
      { email: 'me@example.com', response_status: 'declined' as const },
    ]
    expect(isDeclinedEvent({ ...base, attendees: answers }, ['work@example.com', 'me@example.com'])).toBe(false)
    expect(isDeclinedEvent({ ...base, attendees: [answers[0]!, { ...answers[1]!, self: true }].map((a, i) => ({ ...a, self: i === 1 })) }, [])).toBe(true)
  })

  it('is false when self accepted', () => {
    const accepted = {
      ...base,
      attendees: [{ email: 'me@example.com', response_status: 'accepted' as const }],
    }
    expect(isDeclinedEvent(accepted, ['me@example.com'])).toBe(false)
  })
})

describe('filterWeekends', () => {
  it('removes Saturday and Sunday', () => {
    const days = getVisibleDays(new Date('2026-07-08T00:00:00'), 'week')
    const weekdays = filterWeekends(days)
    expect(days).toHaveLength(7)
    expect(weekdays).toHaveLength(5)
  })
})

describe('getVisibleDays', () => {
  it('day view returns one day', () => {
    expect(getVisibleDays(new Date('2026-07-06T00:00:00'), 'day')).toHaveLength(1)
  })

  it('week view returns 7 days', () => {
    expect(getVisibleDays(new Date('2026-07-06T00:00:00'), 'week')).toHaveLength(7)
  })

  it('2weeks view returns 14 days (not collapsed to a week)', () => {
    expect(getVisibleDays(new Date('2026-07-06T00:00:00'), '2weeks')).toHaveLength(14)
  })

  it('custom view returns N days clamped to 1-9', () => {
    expect(getVisibleDays(new Date('2026-07-06T00:00:00'), 'custom', 5)).toHaveLength(5)
    expect(getVisibleDays(new Date('2026-07-06T00:00:00'), 'custom', 99)).toHaveLength(9)
    expect(getVisibleDays(new Date('2026-07-06T00:00:00'), 'custom', 0)).toHaveLength(1)
  })

  it('month view returns whole weeks', () => {
    const days = getVisibleDays(new Date('2026-07-06T00:00:00'), 'month')
    expect(days.length % 7).toBe(0)
  })
})
