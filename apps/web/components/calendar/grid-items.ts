import { format, parseISO, setHours, setMinutes } from 'date-fns'
import type { CalendarEvent, Task, Routine, Calendar } from '@poolendar/types'
import type { CalendarItemData } from './calendar-types'
import { expandOccurrences, occurrenceItemId } from '@/lib/recurrence'

const DAY_CODE_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

const FALLBACK_COLOR = '#f9a825'

/** Resolve a calendar item's color: explicit override, else its calendar. */
export function getCalendarColor(
  calendars: Calendar[],
  calendarId: string | null,
  colorOverride: string | null
): string {
  if (colorOverride) return colorOverride
  if (calendarId) {
    const cal = calendars.find((c) => c.id === calendarId)
    if (cal) return cal.color
  }
  return FALLBACK_COLOR
}

export function eventsToItems(
  events: CalendarEvent[],
  calendars: Calendar[],
  window: { start: Date; end: Date },
): CalendarItemData[] {
  const hidden = new Set(calendars.filter((c) => !c.is_active).map((c) => c.id))
  return events
    .filter((e) => e.status !== 'cancelled' && !hidden.has(e.calendar_id))
    .flatMap((event) => {
      const common = {
        type: 'event' as const,
        title: event.title,
        color: getCalendarColor(calendars, event.calendar_id, event.color_override),
        isAllDay: event.is_all_day,
        location: event.location,
        event,
      }
      if (!event.recurrence_rule) {
        return [
          {
            ...common,
            id: event.id,
            startTime: parseISO(event.start_time),
            endTime: parseISO(event.end_time),
          },
        ]
      }
      // One item per occurrence in view, each carrying which one it is in its id.
      return expandOccurrences(event, window.start, window.end).map((occurrence) => ({
        ...common,
        id: occurrenceItemId(event.id, occurrence.start),
        startTime: occurrence.start,
        endTime: occurrence.end,
      }))
    })
}

export function tasksToItems(
  tasks: Task[],
  calendars: Calendar[]
): CalendarItemData[] {
  return tasks
    .filter((t) => t.scheduled_start && t.scheduled_end && !t.is_split)
    .map((task) => {
      let subtaskProgress: { completed: number; total: number } | null = null
      if (task.subtasks && task.subtasks.length > 0) {
        subtaskProgress = {
          completed: task.subtasks.filter((s) => s.completed).length,
          total: task.subtasks.length,
        }
      }

      return {
        id: task.id,
        type: 'task' as const,
        title: task.title,
        startTime: parseISO(task.scheduled_start!),
        endTime: parseISO(task.scheduled_end!),
        color: getCalendarColor(calendars, task.calendar_id, null),
        location: task.location,
        task,
        subtaskProgress,
      }
    })
}

export function routinesToItems(
  routines: Routine[],
  visibleDays: Date[],
  calendars: Calendar[]
): CalendarItemData[] {
  const items: CalendarItemData[] = []

  for (const routine of routines) {
    const startParts = routine.start_time.split('T')
    const endParts = routine.end_time.split('T')

    // Routine times may be "HH:mm[:ss]" (Postgres time) or "...THH:mm".
    const startTimePart = startParts.length > 1 ? startParts[1]! : startParts[0]!
    const endTimePart = endParts.length > 1 ? endParts[1]! : endParts[0]!

    let startHour = 9
    let startMinute = 0
    let endHour = 10
    let endMinute = 0

    const sParts = startTimePart.split(':')
    if (sParts.length >= 2) {
      startHour = parseInt(sParts[0] ?? '9', 10) || 0
      startMinute = parseInt(sParts[1] ?? '0', 10) || 0
    }
    const eParts = endTimePart.split(':')
    if (eParts.length >= 2) {
      endHour = parseInt(eParts[0] ?? '10', 10) || 0
      endMinute = parseInt(eParts[1] ?? '0', 10) || 0
    }

    let allowedDays: number[] | null = null
    if (routine.recurrence_rule) {
      const byDayMatch = routine.recurrence_rule.match(/BYDAY=([A-Z,]+)/)
      if (byDayMatch) {
        allowedDays = byDayMatch[1]!
          .split(',')
          .map((d) => DAY_CODE_MAP[d])
          .filter((d): d is number => d !== undefined)
      }
      if (routine.recurrence_rule.includes('FREQ=DAILY')) {
        allowedDays = null
      }
    }

    for (const day of visibleDays) {
      if (allowedDays && !allowedDays.includes(day.getDay())) continue

      const startTime = setMinutes(setHours(new Date(day), startHour), startMinute)
      startTime.setSeconds(0, 0)
      const endTime = setMinutes(setHours(new Date(day), endHour), endMinute)
      endTime.setSeconds(0, 0)

      items.push({
        id: `${routine.id}-${format(day, 'yyyy-MM-dd')}`,
        type: 'routine',
        title: routine.title,
        startTime,
        endTime,
        color: getCalendarColor(calendars, routine.calendar_id, null),
        location: routine.location,
        routine,
      })
    }
  }

  return items
}
