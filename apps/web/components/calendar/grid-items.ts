import { format, parseISO, startOfDay, endOfDay } from 'date-fns'
import type { CalendarEvent, Task, Routine, RoutineInstance, Calendar } from '@poolendar/types'
import type { CalendarItemData } from './calendar-types'
import { expandOccurrences, occurrenceItemId, routineOccursOn, dateInZone, wallClockToInstant } from '@/lib/recurrence'

const FALLBACK_COLOR = '#f9a825'

// All-day timestamps encode calendar dates, not instants in the viewer's zone.
function gridDate(iso: string, allDay: boolean): Date {
  return parseISO(allDay ? iso.slice(0, 10) : iso)
}

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
            startTime: gridDate(event.start_time, event.is_all_day),
            endTime: gridDate(event.end_time, event.is_all_day),
          },
        ]
      }
      // One item per occurrence in view, each carrying which one it is in its id.
      const start = event.is_all_day ? new Date(`${format(window.start, 'yyyy-MM-dd')}T00:00:00.000Z`) : window.start
      const end = event.is_all_day ? new Date(`${format(window.end, 'yyyy-MM-dd')}T23:59:59.999Z`) : window.end
      return expandOccurrences(event, start, end).map((occurrence) => ({
        ...common,
        id: occurrenceItemId(event.id, occurrence.start),
        startTime: gridDate(occurrence.start.toISOString(), event.is_all_day),
        endTime: gridDate(occurrence.end.toISOString(), event.is_all_day),
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
  calendars: Calendar[],
  instances: RoutineInstance[] = [],
): CalendarItemData[] {
  const items: CalendarItemData[] = []
  const byDate = new Map(instances.map(instance => [`${instance.routine_id}-${instance.date}`, instance]))

  for (const routine of routines) {
    const visibleDates = new Set(visibleDays.map(day => format(day, 'yyyy-MM-dd')))
    const hostDates = new Set(visibleDays.flatMap(day => [
      dateInZone(startOfDay(day), routine.timezone), dateInZone(endOfDay(day), routine.timezone),
    ]))
    for (const date of hostDates) {
      const anchor = `${dateInZone(new Date(routine.created_at), routine.timezone)}T00:00:00Z`
      if (!routineOccursOn(routine.recurrence_rule, anchor, date)) continue
      const startTime = wallClockToInstant(date, routine.start_time.split('T').pop()!, routine.timezone)
      const endTime = wallClockToInstant(date, routine.end_time.split('T').pop()!, routine.timezone)
      if (!visibleDates.has(format(startTime, 'yyyy-MM-dd'))) continue

      items.push({
        id: `${routine.id}-${date}`,
        type: 'routine',
        title: routine.title,
        startTime,
        endTime,
        color: getCalendarColor(calendars, routine.calendar_id, null),
        location: routine.location,
        routine,
        routineInstanceStatus: byDate.get(`${routine.id}-${date}`)?.status,
      })
    }
  }

  return items
}
