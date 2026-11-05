import * as React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CalendarGrid } from '../CalendarGrid'

vi.stubGlobal('React', React)

vi.mock('@/lib/hooks/use-routines', () => ({ useCalendarRoutineInstances: () => ({ data: [] }) }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => { cleanup(); vi.useRealTimers() })

it('dismisses a creation bubble on the first grid click and opens another on the next click', () => {
  const { container } = render(<CalendarGrid view="day" currentDate={new Date(2026, 10, 5)} events={[]} tasks={[]} routines={[]} calendars={[]} />)
  const column = container.querySelector('[data-day-column]') as HTMLElement
  expect(column).toBeTruthy()
  function clickSlot(y: number) {
    fireEvent.mouseDown(column, { button: 0, clientY: y })
    fireEvent.mouseUp(column, { button: 0, clientY: y })
    fireEvent.click(column, { button: 0, clientY: y })
    act(() => { vi.advanceTimersByTime(350) })
  }
  clickSlot(300)
  expect(screen.queryByRole('dialog')).not.toBeNull()
  clickSlot(500)
  expect(screen.queryByRole('dialog')).toBeNull()
  clickSlot(600)
  expect(screen.queryByRole('dialog')).not.toBeNull()
})
