'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CalendarEvent, Routine, Task } from '@poolendar/types'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { useUIStore } from '@/lib/stores/ui-store'
import { useUndoable } from '@/lib/hooks/use-undoable'
import { eventKeys } from '@/lib/hooks/use-events'
import { taskKeys } from '@/lib/hooks/use-tasks'
import { routineKeys } from '@/lib/hooks/use-routines'

/** Find an entity by id across every cached list for a query key. */
function findInCache<T extends { id: string }>(
  qc: ReturnType<typeof useQueryClient>,
  key: readonly unknown[],
  id: string
): T | undefined {
  for (const [, data] of qc.getQueriesData<T[]>({ queryKey: key })) {
    const hit = data?.find((item) => item.id === id)
    if (hit) return hit
  }
  return undefined
}

/**
 * The Delete / Backspace key on the selected grid item. Events and tasks delete (with undo); a
 * routine occurrence asks for its scope first, like every other way of deleting one.
 */
export function useDeleteSelected() {
  const queryClient = useQueryClient()
  const undoable = useUndoable()
  const openRoutineDeletePrompt = useUIStore((s) => s.openRoutineDeletePrompt)

  return useCallback(() => {
    const { selectedItemId: id, selectedItemType: type, selectedOccurrenceDate } = useCalendarStore.getState()
    if (!id || !type) return
    if (type === 'event') {
      const ev = findInCache<CalendarEvent>(queryClient, eventKeys.lists(), id)
      if (ev) undoable.deleteEvent(ev)
    } else if (type === 'task') {
      const t = findInCache<Task>(queryClient, taskKeys.lists(), id)
      if (t) undoable.deleteTask(t)
    } else if (findInCache<Routine>(queryClient, routineKeys.lists(), id)) {
      openRoutineDeletePrompt({ routineId: id, date: selectedOccurrenceDate })
    }
  }, [queryClient, undoable, openRoutineDeletePrompt])
}
