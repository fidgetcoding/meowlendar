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

it('dismisses an existing item preview without creating a new draft', () => {
  const props = { view: 'day' as const, currentDate: new Date(2026, 10, 5), events: [], tasks: [], routines: [], calendars: [] }
  const { container, rerender } = render(<CalendarGrid {...props} itemPreviewOpen />)
  const column = container.querySelector('[data-day-column]') as HTMLElement
  fireEvent.mouseDown(column, { button: 0, clientY: 300 })
  fireEvent.mouseUp(column, { button: 0, clientY: 300 })
  fireEvent.click(column, { button: 0, clientY: 300 })
  act(() => { vi.advanceTimersByTime(350) })
  expect(screen.queryByRole('dialog')).toBeNull()
  rerender(<CalendarGrid {...props} itemPreviewOpen={false} />)
  fireEvent.mouseDown(column, { button: 0, clientY: 400 })
  fireEvent.mouseUp(column, { button: 0, clientY: 400 })
  fireEvent.click(column, { button: 0, clientY: 400 })
  act(() => { vi.advanceTimersByTime(350) })
  expect(screen.queryByRole('dialog')).not.toBeNull()
})

it('double clicking an empty slot opens the full editor beside the new slot', () => {
  const onOpenFullForm = vi.fn()
  const { container } = render(<CalendarGrid view="day" currentDate={new Date(2026, 10, 5)} events={[]} tasks={[]} routines={[]} calendars={[]} onOpenFullForm={onOpenFullForm} />)
  const column = container.querySelector('[data-day-column]') as HTMLElement
  fireEvent.doubleClick(column, { clientY: 300 })
  expect(onOpenFullForm).toHaveBeenCalledWith(
    'event', expect.any(Date), expect.any(Date), expect.any(Date),
    expect.objectContaining({ left: expect.any(Number), top: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }),
  )
  // Straight to the editor: no quick-add bubble in between.
  expect(screen.queryByRole('dialog')).toBeNull()
})

// calendar-scroll.spec failed under load: the grid's start hour arrived from saved settings after
// the test had scrolled, and the auto-scroll to 8 AM pulled the grid back to 120px.
it('never moves the grid once someone has scrolled it, even when the start hour arrives late', () => {
  const props = { view: 'week' as const, currentDate: new Date(2026, 10, 5), events: [], tasks: [], routines: [], calendars: [], hourHeight: 60 }
  const { container, rerender } = render(<CalendarGrid {...props} startHour={0} />)
  const scroller = container.querySelector('.meow-scroller') as HTMLElement
  expect(scroller.scrollTop).toBe(8 * 60)

  fireEvent.wheel(scroller, { deltaY: -5000 })
  scroller.scrollTop = 0
  rerender(<CalendarGrid {...props} startHour={6} />)
  expect(scroller.scrollTop).toBe(0)
})

// The e2e case: a script sets scrollTop, then the saved start hour arrives.
it('never moves the grid after a script scrolls it, even when the start hour arrives late', () => {
  const props = { view: 'week' as const, currentDate: new Date(2026, 10, 5), events: [], tasks: [], routines: [], calendars: [], hourHeight: 60 }
  const { container, rerender } = render(<CalendarGrid {...props} startHour={0} />)
  const scroller = container.querySelector('.meow-scroller') as HTMLElement
  scroller.scrollTop = 0
  rerender(<CalendarGrid {...props} startHour={6} />)
  expect(scroller.scrollTop).toBe(0)
  rerender(<CalendarGrid {...props} startHour={6} currentDate={new Date(2026, 10, 12)} />)
  expect(scroller.scrollTop).toBe(0)
})

it('keeps 8 AM at the top when the start hour arrives late and nobody has scrolled', () => {
  const props = { view: 'week' as const, currentDate: new Date(2026, 10, 5), events: [], tasks: [], routines: [], calendars: [], hourHeight: 60 }
  const { container, rerender } = render(<CalendarGrid {...props} startHour={0} />)
  rerender(<CalendarGrid {...props} startHour={6} />)
  expect((container.querySelector('.meow-scroller') as HTMLElement).scrollTop).toBe(2 * 60)
})
