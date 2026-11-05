import * as React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '@poolendar/types'
import { CalendarGrid } from '../CalendarGrid'

vi.stubGlobal('React', React)
vi.mock('@/lib/hooks/use-routines', () => ({ useCalendarRoutineInstances: () => ({ data: [] }) }))
afterEach(cleanup)

// What the edit form now saves for a one-day all-day event on Thursday Nov 5.
const holiday = {
  id: 'holiday', calendar_id: 'c1', title: 'Election Day', status: 'confirmed', is_all_day: true, timezone: 'UTC',
  start_time: '2026-11-05T00:00:00.000Z', end_time: '2026-11-06T00:00:00.000Z', recurrence_rule: null, attendees: [],
} as unknown as CalendarEvent

it('draws a one-day all-day event in the all-day row of its day only', () => {
  const { container } = render(<CalendarGrid view="week" currentDate={new Date(2026, 10, 5)} events={[holiday]} tasks={[]} routines={[]} calendars={[]} />)
  const cells = [...container.querySelectorAll('.meow-gall .meow-ac')]
  const withChip = cells.map((cell) => cell.textContent?.includes('Election Day'))
  // Sun..Sat, the chip on Thursday only, and never on the timed grid.
  expect(withChip).toEqual([false, false, false, false, true, false, false])
  expect(container.querySelector('[data-day-column] [data-item-id="holiday"]')).toBeNull()
})
