import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import type { Routine, Task } from '@poolendar/types'
import { useCalendarStore } from '@/lib/stores/calendar-store'

const updateTask = vi.fn()
const updateRoutine = vi.fn()
vi.mock('@/lib/hooks/use-tasks', () => ({ useUpdateTask: () => ({ mutate: updateTask }) }))
vi.mock('@/lib/hooks/use-routines', () => ({ useUpdateRoutine: () => ({ mutate: updateRoutine }) }))

import { useSidebarCalendarDrop } from '../use-sidebar-calendar-drop'

const COLUMN_TOP = 100
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

function dropAt(data: Record<string, unknown>, clientY: number) {
  const column = document.createElement('div')
  column.dataset.dayColumn = '2026-11-05'
  column.getBoundingClientRect = () => ({ top: COLUMN_TOP, left: 0, right: 100, bottom: 2000, width: 100, height: 1900, x: 0, y: COLUMN_TOP, toJSON: () => ({}) })
  document.body.appendChild(column)
  document.elementsFromPoint = vi.fn(() => [column])
  const { result } = renderHook(() => useSidebarCalendarDrop())
  result.current.handleDragEnd({
    active: { id: 'drag', data: { current: data } },
    over: null,
    delta: { x: 0, y: clientY },
    activatorEvent: new MouseEvent('pointerdown', { clientX: 10, clientY: 0 }),
  } as unknown as DragEndEvent)
}

describe('dropping from the side panel onto the grid', () => {
  beforeEach(() => {
    useCalendarStore.setState({ hourHeight: 60, timeGridStart: 6, timeGridEnd: 22, timeDraggingResolution: 15 })
  })
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('schedules a task at the slot under the pointer, counting from the grid start, in the local zone', () => {
    // 10.5 hours below a grid that starts at 06:00 is 4:30 PM.
    dropAt({ type: 'sidebar-task', task: { id: 't1', time_estimate_minutes: 45 } as Task }, COLUMN_TOP + 10.5 * 60)
    expect(updateTask).toHaveBeenCalledWith({
      id: 't1',
      data: {
        scheduled_start: new Date(2026, 10, 5, 16, 30).toISOString(),
        scheduled_end: new Date(2026, 10, 5, 17, 15).toISOString(),
      },
    })
  })

  it("moves a routine to that wall-clock time in the routine's own zone, keeping its length", () => {
    const routine = { id: 'r1', start_time: '08:00', end_time: '08:45', timezone: LOCAL_ZONE } as Routine
    dropAt({ type: 'sidebar-routine', routine }, COLUMN_TOP + 10.5 * 60)
    expect(updateRoutine).toHaveBeenCalledWith({ id: 'r1', data: { start_time: '16:30', end_time: '17:15' } })
  })
})
