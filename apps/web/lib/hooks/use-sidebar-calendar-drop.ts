'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import type { Task, Routine } from '@poolendar/types'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { useUpdateTask } from '@/lib/hooks/use-tasks'
import { useUpdateRoutine } from '@/lib/hooks/use-routines'
import { timeInZone } from '@/lib/recurrence'

/**
 * Drop-onto-calendar logic for sidebar tasks/routines (#33). Extracted from the
 * app layout. The calendar has its own inner DndContext, so the drop target is
 * resolved from pointer coordinates against DayColumn `data-day-column` nodes.
 */
export function useSidebarCalendarDrop() {
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const updateTask = useUpdateTask()
  const updateRoutine = useUpdateRoutine()

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id))
  }

  function handleSidebarDrop(
    dragData: { type: string; task?: Task; routine?: Routine },
    dayColumnEl: HTMLElement,
    clientY: number
  ) {
    const rect = dayColumnEl.getBoundingClientRect()
    const { hourHeight: storeHourHeight, timeDraggingResolution, timeGridStart, timeGridEnd } = useCalendarStore.getState()
    const hourHeight = storeHourHeight || 60
    const resolution = timeDraggingResolution || 15
    // The column's top edge is the grid's first hour, not midnight.
    const gridStartMinutes = (timeGridStart ?? 0) * 60
    const gridEndMinutes = (timeGridEnd ?? 24) * 60
    const yOffset = clientY - rect.top
    const rawMinutes = gridStartMinutes + (yOffset / hourHeight) * 60
    const snappedMinutes = Math.round(rawMinutes / resolution) * resolution
    const clampedMinutes = Math.max(gridStartMinutes, Math.min(gridEndMinutes - resolution, snappedMinutes))

    const dateAttr = dayColumnEl.dataset.dayColumn
    const dateStr = dateAttr || format(new Date(), 'yyyy-MM-dd')
    // The slot is wall-clock time in the viewer's zone, as the grid draws it.
    const [year = 1970, month = 1, day = 1] = dateStr.split('-').map(Number)
    const at = (minutes: number) => new Date(year, month - 1, day, 0, minutes)
    const start = at(clampedMinutes)

    if (dragData.type === 'sidebar-task' && dragData.task) {
      const task = dragData.task
      const duration = task.time_estimate_minutes || 30

      updateTask.mutate({
        id: task.id,
        data: {
          scheduled_start: start.toISOString(),
          scheduled_end: at(clampedMinutes + duration).toISOString(),
        },
      })
    }

    if (dragData.type === 'sidebar-routine' && dragData.routine) {
      const routine = dragData.routine
      // Routine times are "HH:mm" wall-clock in the routine's own zone (older rows may carry a date).
      const minutesOf = (value: string, fallback: number) => {
        const [h, m] = (value.split('T').pop() ?? '').split(':').map(Number)
        return h === undefined || Number.isNaN(h) ? fallback : h * 60 + (m || 0)
      }
      let durationMinutes = minutesOf(routine.end_time, 10 * 60) - minutesOf(routine.start_time, 9 * 60)
      if (durationMinutes <= 0) durationMinutes = 60

      updateRoutine.mutate({
        id: routine.id,
        data: {
          start_time: timeInZone(start, routine.timezone),
          end_time: timeInZone(at(clampedMinutes + durationMinutes), routine.timezone),
        },
      })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)

    const { active, over } = event
    const dragData = active.data?.current as
      | { type: string; task?: Task; routine?: Routine }
      | undefined

    if (!dragData) return

    if (dragData.type === 'sidebar-task' || dragData.type === 'sidebar-routine') {
      const activatorEvent = event.activatorEvent as MouseEvent | TouchEvent
      let clientX: number
      let clientY: number

      const deltaX = event.delta?.x ?? 0
      const deltaY = event.delta?.y ?? 0

      if ('touches' in activatorEvent && activatorEvent.touches.length > 0) {
        clientX = activatorEvent.touches[0]!.clientX + deltaX
        clientY = activatorEvent.touches[0]!.clientY + deltaY
      } else if ('clientX' in activatorEvent) {
        clientX = (activatorEvent as MouseEvent).clientX + deltaX
        clientY = (activatorEvent as MouseEvent).clientY + deltaY
      } else {
        return
      }

      const elements = document.elementsFromPoint(clientX, clientY)
      const dayColumnEl = elements.find(
        (el) => el instanceof HTMLElement && el.dataset?.dayColumn !== undefined
      ) as HTMLElement | undefined

      if (!dayColumnEl) {
        const calArea = elements.find(
          (el) => el instanceof HTMLElement && el.closest('[data-day-column]') !== null
        )
        if (calArea) {
          const col = (calArea as HTMLElement).closest('[data-day-column]') as HTMLElement | null
          if (col) {
            handleSidebarDrop(dragData, col, clientY)
            return
          }
        }
        return
      }

      handleSidebarDrop(dragData, dayColumnEl, clientY)
      return
    }

    if (!over || active.id === over.id) return
  }

  return { activeDragId, handleDragStart, handleDragEnd }
}
