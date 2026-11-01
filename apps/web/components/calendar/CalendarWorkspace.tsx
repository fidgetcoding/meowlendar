'use client'

import * as React from 'react'
import { format } from 'date-fns'
import type {
  CalendarEvent,
  Task,
  Routine,
  Calendar,
} from '@poolendar/types'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { useUIStore } from '@/lib/stores/ui-store'
import { useCalendarContextActions } from '@/lib/hooks/use-calendar-context-actions'
import { useUndoable } from '@/lib/hooks/use-undoable'
import { CalendarGrid } from './CalendarGrid'
import { PreviewPopover } from './PreviewPopover'
import { ContextMenu } from './ContextMenu'
import type { CalendarItemData, CalendarItemType } from './calendar-types'
import { parseRoutineItemId } from './grid-helpers'
import { parseEventItemId } from '@/lib/recurrence'
import { useRecurringEventChange } from '@/lib/hooks/use-events'
import type { RecurrenceEditScope } from './RecurrenceEditDialog'

interface CalendarWorkspaceProps {
  events: CalendarEvent[]
  tasks: Task[]
  routines: Routine[]
  calendars: Calendar[]
  selfEmails: string[]
  userId: string | null
  currentDate: Date
}

function twoDigit(n: number): string {
  return String(n).padStart(2, '0')
}
function toTimeString(d: Date): string {
  return `${twoDigit(d.getHours())}:${twoDigit(d.getMinutes())}`
}

export function CalendarWorkspace({
  events,
  tasks,
  routines,
  calendars,
  selfEmails,
  userId,
  currentDate,
}: CalendarWorkspaceProps) {
  const store = useCalendarStore()
  const { openEditForm } = useUIStore()
  const recurringChange = useRecurringEventChange()

  const undoable = useUndoable()

  const ctx = useCalendarContextActions({
    events,
    tasks,
    routines,
    calendars,
    userId,
    currentDate,
  })

  const [preview, setPreview] = React.useState<{
    item: {
      type: CalendarItemType
      event?: CalendarEvent
      task?: Task
      routine?: Routine
      calendarName?: string
      calendarColor?: string
    }
    source: CalendarItemData
    anchorRect: DOMRect | null
  } | null>(null)

  const defaultCalendarId = calendars.find((c) => c.is_primary)?.id ?? calendars[0]?.id ?? null

  // ---- helpers ----
  function routineDateOf(item: CalendarItemData): string {
    return format(item.startTime, 'yyyy-MM-dd')
  }

  function createRoutineRow(
    over: Partial<Routine> & { title: string }
  ) {
    undoable.createRoutine({
      user_id: userId,
      calendar_id: over.calendar_id ?? defaultCalendarId,
      title: over.title,
      notes: over.notes ?? null,
      start_time: over.start_time ?? '09:00',
      end_time: over.end_time ?? '10:00',
      timezone: over.timezone ?? 'America/New_York',
      recurrence_rule: over.recurrence_rule ?? 'FREQ=DAILY',
      location: over.location ?? null,
      visibility: over.visibility ?? 'busy',
      privacy: over.privacy ?? 'private',
      reminders: over.reminders ?? [],
    })
  }

  // ---- grid interactions (#14) ----
  function handleReschedule(
    itemId: string,
    itemType: CalendarItemType,
    newStart: Date,
    newEnd: Date
  ) {
    if (itemType === 'event') {
      const { eventId, occurrenceStart } = parseEventItemId(itemId)
      const prev = events.find((e) => e.id === eventId)
      if (!prev) return
      // Dragging one occurrence moves just that occurrence.
      if (occurrenceStart) {
        recurringChange.mutate({
          id: eventId,
          scope: 'single',
          occurrenceStart,
          patch: { start_time: newStart.toISOString(), end_time: newEnd.toISOString() },
        })
        return
      }
      undoable.updateEvent(
        itemId,
        {
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString(),
          sync_status: 'pending_push',
        },
        prev
      )
    } else if (itemType === 'task') {
      const prev = tasks.find((t) => t.id === itemId)
      if (!prev) return
      undoable.scheduleTask(
        itemId,
        newStart.toISOString(),
        newEnd.toISOString(),
        prev
      )
    } else {
      const { routineId } = parseRoutineItemId(itemId)
      const prev = routines.find((r) => r.id === routineId)
      if (!prev) return
      undoable.updateRoutine(
        routineId,
        { start_time: toTimeString(newStart), end_time: toTimeString(newEnd) },
        prev
      )
    }
  }

  function handleResize(itemId: string, itemType: CalendarItemType, newEnd: Date) {
    if (itemType === 'event') {
      const { eventId, occurrenceStart } = parseEventItemId(itemId)
      const prev = events.find((e) => e.id === eventId)
      if (!prev) return
      if (occurrenceStart) {
        recurringChange.mutate({
          id: eventId,
          scope: 'single',
          occurrenceStart,
          patch: { start_time: occurrenceStart, end_time: newEnd.toISOString() },
        })
        return
      }
      undoable.updateEvent(
        itemId,
        { end_time: newEnd.toISOString(), sync_status: 'pending_push' },
        prev
      )
    } else if (itemType === 'task') {
      const prev = tasks.find((t) => t.id === itemId)
      if (!prev) return
      undoable.updateTask(itemId, { scheduled_end: newEnd.toISOString() }, prev)
    } else {
      const { routineId } = parseRoutineItemId(itemId)
      const prev = routines.find((r) => r.id === routineId)
      if (!prev) return
      undoable.updateRoutine(routineId, { end_time: toTimeString(newEnd) }, prev)
    }
  }

  function handleQuickCreate(
    title: string,
    type: CalendarItemType,
    startTime: Date,
    endTime?: Date
  ) {
    const end = endTime ?? new Date(startTime.getTime() + store.defaultTaskDuration * 60000)

    if (type === 'event') {
      if (!defaultCalendarId) {
        // No calendar to attach the event to — open the full form instead.
        openEditForm(null, 'event', 'event', {
          title,
          start_time: startTime.toISOString(),
          end_time: end.toISOString(),
        })
        return
      }
      undoable.createEvent({
        user_id: userId,
        calendar_id: defaultCalendarId,
        google_event_id: null,
        title,
        notes: null,
        start_time: startTime.toISOString(),
        end_time: end.toISOString(),
        timezone: 'America/New_York',
        is_all_day: false,
        location: null,
        color_override: null,
        visibility: 'busy',
        privacy: 'public',
        conferencing_url: null,
        recurrence_rule: null,
        recurrence_id: null,
        attendees: [],
        reminders: [],
        status: 'confirmed',
        sync_status: 'pending_push',
        etag: null,
      })
    } else if (type === 'task') {
      undoable.createTask({
        user_id: userId,
        calendar_id: defaultCalendarId,
        parent_id: null,
        title,
        notes: null,
        importance: 'normal',
        time_estimate_minutes: null,
        earliest_start: null,
        due_date: null,
        due_date_recurrence: null,
        scheduled_start: startTime.toISOString(),
        scheduled_end: end.toISOString(),
        location: null,
        visibility: 'busy',
        privacy: 'private',
        flexibility: 'flexible',
        status: 'backlog',
        board: 'current',
        is_split: false,
        completed_at: null,
        position: null,
        reminders: [],
      })
    } else {
      createRoutineRow({
        title,
        start_time: toTimeString(startTime),
        end_time: toTimeString(end),
      })
    }
  }

  function handleOpenFullForm(
    type: CalendarItemType,
    date: Date,
    startTime: Date,
    endTime?: Date
  ) {
    const end = endTime ?? new Date(startTime.getTime() + store.defaultTaskDuration * 60000)
    if (type === 'event') {
      openEditForm(null, 'event', 'event', {
        start_time: startTime.toISOString(),
        end_time: end.toISOString(),
        calendar_id: defaultCalendarId,
      })
    } else if (type === 'task') {
      openEditForm(null, 'task', 'task', {
        scheduled_start: startTime.toISOString(),
        scheduled_end: end.toISOString(),
      })
    } else {
      openEditForm(null, 'routine', 'routine', {
        start_time: toTimeString(startTime),
        end_time: toTimeString(end),
      })
    }
  }

  // ---- single click: preview (#15) ----
  function handleItemClick(item: CalendarItemData, anchorRect?: DOMRect) {
    // Track the clicked item as the keyboard selection (E / ⇧R / ⇧S / Delete).
    const selectionId =
      item.type === 'routine'
        ? parseRoutineItemId(item.id).routineId
        : item.type === 'event'
          ? parseEventItemId(item.id).eventId
          : item.id
    store.selectItem(selectionId, item.type)
    const calId =
      item.event?.calendar_id ?? item.task?.calendar_id ?? item.routine?.calendar_id ?? null
    const cal = calId ? calendars.find((c) => c.id === calId) : undefined
    setPreview({
      item: {
        type: item.type,
        event: item.event,
        task: item.task,
        routine: item.routine,
        calendarName: cal?.name,
        calendarColor: item.color,
      },
      source: item,
      anchorRect: anchorRect ?? null,
    })
  }

  function handleItemDoubleClick(item: CalendarItemData) {
    setPreview(null)
    openEditForm(item.id, item.type)
  }

  function handleTaskCheckbox(item: CalendarItemData) {
    if (!item.task) return
    if (item.task.status === 'done') {
      undoable.reopenTask(item.task)
    } else {
      undoable.completeTask(item.task)
    }
  }

  function handleRoutineCheckbox(item: CalendarItemData) {
    if (!item.routine) return
    const date = routineDateOf(item)
    if (item.routineInstanceStatus === 'completed') {
      // Toggling off a completed instance reverts it to pending.
      undoable.resetRoutineInstance(item.routine.id, date)
    } else {
      undoable.completeRoutineInstance(item.routine.id, date)
    }
  }

  // ---- preview actions ----
  function deleteBySource(source: CalendarItemData, scope?: RecurrenceEditScope) {
    if (source.type === 'event' && source.event) {
      if (scope && source.event.recurrence_rule) {
        recurringChange.mutate({
          id: source.event.id,
          scope: scope.type,
          occurrenceStart: parseEventItemId(source.id).occurrenceStart,
          dates: scope.type === 'custom' ? scope.dates : undefined,
        })
        return
      }
      undoable.deleteEvent(source.event)
    } else if (source.type === 'task' && source.task) {
      undoable.deleteTask(source.task)
    } else if (source.routine) {
      undoable.deleteRoutine(source.routine)
    }
  }

  return (
    <>
      <CalendarGrid
        view={store.view}
        currentDate={currentDate}
        customDays={store.customDays}
        events={events}
        tasks={tasks}
        routines={routines}
        calendars={calendars}
        hourHeight={store.hourHeight}
        startHour={store.timeGridStart}
        endHour={store.timeGridEnd}
        draggingResolution={store.timeDraggingResolution}
        limitPerDay={store.limitEventsPerDay}
        widenCurrentDay={store.widenCurrentDay}
        dimPastEvents={store.dimPastEvents}
        showWeekends={store.showWeekends}
        showCompletedTasks={store.showCompletedTasks}
        showDeclinedEvents={store.showDeclinedEvents}
        mergeDuplicateEvents={store.mergeDuplicateEvents}
        showWeekNumbers
        selfEmails={selfEmails}
        onItemClick={handleItemClick}
        onItemDoubleClick={handleItemDoubleClick}
        onItemReschedule={handleReschedule}
        onItemResize={handleResize}
        onQuickCreate={handleQuickCreate}
        onOpenFullForm={handleOpenFullForm}
        onRoutineCheckboxClick={handleRoutineCheckbox}
        onTaskCheckboxClick={handleTaskCheckbox}
      />

      {preview && (
        <PreviewPopover
          item={preview.item}
          anchorRect={preview.anchorRect}
          onClose={() => setPreview(null)}
          onEdit={(scope) => {
            const src = preview.source
            setPreview(null)
            openEditForm(src.id, src.type, undefined, undefined, scope?.type ?? null)
          }}
          onDelete={(scope) => {
            deleteBySource(preview.source, scope)
            setPreview(null)
          }}
          onComplete={() => {
            const src = preview.source
            if (src.type === 'task' && src.task) undoable.completeTask(src.task)
            else if (src.type === 'routine' && src.routine)
              undoable.completeRoutineInstance(src.routine.id, routineDateOf(src))
            setPreview(null)
          }}
          onSkip={() => {
            const src = preview.source
            if (src.routine)
              undoable.skipRoutineInstance(src.routine.id, routineDateOf(src))
            setPreview(null)
          }}
        />
      )}

      <ContextMenu
        item={ctx.ctxItem}
        onEdit={ctx.onEdit}
        onDelete={ctx.onDelete}
        onDuplicate={ctx.onDuplicate}
        onComplete={ctx.onComplete}
        onSkip={ctx.onSkip}
        onConvert={ctx.onConvert}
        onSplit={ctx.onSplit}
        onColorOverride={ctx.onColorOverride}
        onJoin={ctx.onJoin}
        onCopyMeetingLink={ctx.onCopyMeetingLink}
        onEmailAttendees={ctx.onEmailAttendees}
        onCreate={ctx.onCreate}
      />
    </>
  )
}
