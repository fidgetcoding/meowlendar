import type { CalendarEvent, Task, Routine, RoutineInstanceStatus } from '@poolendar/types'

export type CalendarItemType = 'event' | 'task' | 'routine'

export interface CalendarItemData {
  id: string
  type: CalendarItemType
  title: string
  startTime: Date
  endTime: Date
  color: string
  isAllDay?: boolean
  location?: string | null
  event?: CalendarEvent
  task?: Task
  subtaskProgress?: { completed: number; total: number } | null
  routine?: Routine
  /** Status of the routine instance for this day (populated by CalendarGrid) */
  routineInstanceStatus?: RoutineInstanceStatus
  /** Other copies of this meeting, on other calendars, hidden by Merge duplicate events. */
  duplicates?: CalendarItemData[]
}
