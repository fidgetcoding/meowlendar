import * as React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Routine } from '@poolendar/types'

vi.stubGlobal('React', React)

const undoable = {
  deleteRoutine: vi.fn(),
  deleteRoutineOccurrences: vi.fn(),
}
vi.mock('@/lib/hooks/use-undoable', () => ({ useUndoable: () => undoable }))
vi.mock('@/lib/hooks/use-routines', () => ({ useCalendarRoutineInstances: () => ({ data: [] }) }))
vi.mock('@/lib/hooks/use-events', () => ({ useRecurringEventChange: () => ({ mutate: vi.fn() }) }))
vi.mock('@/lib/hooks/use-calendar-context-actions', () => ({
  useCalendarContextActions: () => ({
    ctxItem: null, onEdit: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onComplete: vi.fn(), onSkip: vi.fn(),
    onConvert: vi.fn(), onSplit: vi.fn(), onColorOverride: vi.fn(), onJoin: vi.fn(), onCopyMeetingLink: vi.fn(),
    onEmailAttendees: vi.fn(), onCreate: vi.fn(),
  }),
}))

import { CalendarWorkspace } from '../CalendarWorkspace'
import { useCalendarStore } from '@/lib/stores/calendar-store'

const routine = {
  id: 'r1', user_id: 'u', calendar_id: null, title: 'Feed Miso', notes: null, start_time: '08:00', end_time: '08:15',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recurrence_rule: 'FREQ=DAILY', location: null,
  visibility: 'busy', privacy: 'private', reminders: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
} as Routine

// Deleting one occurrence of a routine through the preview's scope dialog used to delete the
// whole routine, whichever scope was picked.
function deleteThursdayWith(option: string) {
  const { container } = render(
    <CalendarWorkspace events={[]} tasks={[]} routines={[routine]} calendars={[]} selfEmails={[]} userId="u" currentDate={new Date(2026, 10, 5)} />,
  )
  fireEvent.click(container.querySelector('[data-item-id="r1-2026-11-05"]')!)
  fireEvent.click(within(screen.getByRole('dialog', { name: /preview/i })).getByRole('button', { name: /delete/i }))
  const scope = screen.getByRole('dialog', { name: /delete recurring item/i })
  fireEvent.click(within(scope).getByLabelText(new RegExp('^' + option)))
  fireEvent.click(within(scope).getByRole('button', { name: 'Delete' }))
}

describe('deleting a routine occurrence', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('"Only this occurrence" removes that date and leaves the routine', () => {
    deleteThursdayWith('Only this occurrence')
    expect(undoable.deleteRoutine).not.toHaveBeenCalled()
    expect(undoable.deleteRoutineOccurrences).toHaveBeenCalledWith(routine, '2026-11-05', { type: 'single' }, undefined)
  })

  it('"This and all future" ends the routine before that date', () => {
    deleteThursdayWith('This and all future')
    expect(undoable.deleteRoutine).not.toHaveBeenCalled()
    expect(undoable.deleteRoutineOccurrences).toHaveBeenCalledWith(routine, '2026-11-05', { type: 'future' }, undefined)
  })

  it('selecting an occurrence remembers its day, so the Delete key knows which one', () => {
    const { container } = render(
      <CalendarWorkspace events={[]} tasks={[]} routines={[routine]} calendars={[]} selfEmails={[]} userId="u" currentDate={new Date(2026, 10, 5)} />,
    )
    fireEvent.click(container.querySelector('[data-item-id="r1-2026-11-05"]')!)
    expect(useCalendarStore.getState()).toMatchObject({ selectedItemId: 'r1', selectedItemType: 'routine', selectedOccurrenceDate: '2026-11-05' })
  })

  it('"All occurrences" deletes the routine', () => {
    deleteThursdayWith('All occurrences')
    expect(undoable.deleteRoutineOccurrences).toHaveBeenCalledWith(routine, '2026-11-05', { type: 'all' }, undefined)
  })
})
