'use client'

import { useMemo } from 'react'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import type { CalendarEvent, Task, Routine, Calendar } from '@poolendar/types'
import { useUIStore } from '@/lib/stores/ui-store'
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from '@/lib/hooks/use-events'
import { useCreateTask, useDeleteTask, useCompleteTask } from '@/lib/hooks/use-tasks'
import {
  useCreateRoutine,
  useCompleteRoutineInstance,
  useSkipRoutineInstance,
} from '@/lib/hooks/use-routines'
import { parseRoutineItemId } from '@/components/calendar/grid-helpers'
import type { ContextMenuItem } from '@/components/calendar/ContextMenu'

interface Params {
  events: CalendarEvent[]
  tasks: Task[]
  routines: Routine[]
  calendars: Calendar[]
  userId: string | null
  currentDate: Date
}

/**
 * All context-menu actions (#15a/#15b), extracted from CalendarWorkspace to keep
 * that file under the 500-line cap. Actions operate on the currently-open menu's
 * item id/type from uiStore.
 */
export function useCalendarContextActions({
  events,
  tasks,
  routines,
  calendars,
  userId,
  currentDate,
}: Params) {
  const queryClient = useQueryClient()
  const { contextMenu, openEditForm, openRoutineDeletePrompt } = useUIStore()

  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const createTask = useCreateTask()
  const deleteTask = useDeleteTask()
  const completeTask = useCompleteTask()
  const createRoutine = useCreateRoutine()
  const completeRoutineInstance = useCompleteRoutineInstance()
  const skipRoutineInstance = useSkipRoutineInstance()

  const defaultCalendarId =
    calendars.find((c) => c.is_primary)?.id ?? calendars[0]?.id ?? null

  const ctxItem: ContextMenuItem | null = useMemo(() => {
    const { itemId, itemType } = contextMenu
    if (!itemId || !itemType) return null
    if (itemType === 'event') {
      const e = events.find((ev) => ev.id === itemId)
      if (!e) return { type: 'event' }
      return {
        type: 'event',
        conferencingUrl: e.conferencing_url,
        attendeeEmails: (e.attendees ?? []).map((a) => a.email),
      }
    }
    return { type: itemType }
  }, [contextMenu, events])

  function ctxEvent(): CalendarEvent | undefined {
    return contextMenu.itemType === 'event'
      ? events.find((e) => e.id === contextMenu.itemId)
      : undefined
  }

  function onEdit() {
    if (contextMenu.itemId && contextMenu.itemType)
      openEditForm(contextMenu.itemId, contextMenu.itemType)
  }

  function onDelete() {
    const { itemId, itemType } = contextMenu
    if (!itemId || !itemType) return
    if (itemType === 'event') deleteEvent.mutate(itemId)
    else if (itemType === 'task') deleteTask.mutate(itemId)
    else {
      // Which occurrences go is the user's call: the scope prompt asks, then deletes with undo.
      const { routineId, date } = parseRoutineItemId(itemId)
      openRoutineDeletePrompt({ routineId, date })
    }
  }

  function onComplete() {
    const { itemId, itemType } = contextMenu
    if (!itemId) return
    if (itemType === 'task') completeTask.mutate(itemId)
    else if (itemType === 'routine') {
      const { routineId, date } = parseRoutineItemId(itemId)
      completeRoutineInstance.mutate({
        routine_id: routineId,
        date: date ?? format(currentDate, 'yyyy-MM-dd'),
      })
    }
  }

  function onSkip() {
    const { itemId } = contextMenu
    if (!itemId) return
    const { routineId, date } = parseRoutineItemId(itemId)
    skipRoutineInstance.mutate({
      routine_id: routineId,
      date: date ?? format(currentDate, 'yyyy-MM-dd'),
    })
  }

  function onColorOverride(color: string) {
    // Only events carry a per-item color override column (#15a).
    if (contextMenu.itemType === 'event' && contextMenu.itemId) {
      updateEvent.mutate({
        id: contextMenu.itemId,
        data: { color_override: color, sync_status: 'pending_push' },
      })
    }
  }

  function onConvert(target: 'event' | 'task' | 'routine') {
    if (contextMenu.itemId && contextMenu.itemType)
      openEditForm(contextMenu.itemId, contextMenu.itemType, target)
  }

  async function onSplit() {
    const { itemId, itemType } = contextMenu
    if (itemType !== 'task' || !itemId) return
    const res = await fetch(`/api/tasks/${itemId}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['subtasks'] })
    if (!res.ok) window.alert('Could not split this task.')
  }

  function onDuplicate() {
    const { itemId, itemType } = contextMenu
    if (!itemId || !userId) return
    if (itemType === 'event') {
      const e = events.find((ev) => ev.id === itemId)
      if (!e) return
      createEvent.mutate({
        user_id: userId,
        calendar_id: e.calendar_id,
        google_event_id: null,
        title: `${e.title} (copy)`,
        notes: e.notes,
        start_time: e.start_time,
        end_time: e.end_time,
        timezone: e.timezone,
        is_all_day: e.is_all_day,
        location: e.location,
        color_override: e.color_override,
        visibility: e.visibility,
        privacy: e.privacy,
        conferencing_url: null,
        recurrence_rule: e.recurrence_rule,
        recurrence_id: null,
        attendees: e.attendees,
        reminders: e.reminders,
        status: 'confirmed',
        sync_status: 'pending_push',
        etag: null,
      })
    } else if (itemType === 'task') {
      const t = tasks.find((tk) => tk.id === itemId)
      if (!t) return
      createTask.mutate({
        user_id: userId,
        calendar_id: t.calendar_id,
        parent_id: null,
        title: `${t.title} (copy)`,
        notes: t.notes,
        importance: t.importance,
        time_estimate_minutes: t.time_estimate_minutes,
        earliest_start: t.earliest_start,
        due_date: t.due_date,
        due_date_recurrence: null,
        scheduled_start: t.scheduled_start,
        scheduled_end: t.scheduled_end,
        location: t.location,
        visibility: t.visibility,
        privacy: t.privacy,
        flexibility: t.flexibility,
        status: 'backlog',
        board: t.board,
        is_split: false,
        completed_at: null,
        position: null,
        reminders: t.reminders,
      })
    } else {
      const { routineId } = parseRoutineItemId(itemId)
      const r = routines.find((rt) => rt.id === routineId)
      if (!r) return
      createRoutine.mutate({
        user_id: userId,
        calendar_id: r.calendar_id ?? defaultCalendarId,
        title: `${r.title} (copy)`,
        notes: r.notes,
        start_time: r.start_time,
        end_time: r.end_time,
        timezone: r.timezone,
        recurrence_rule: r.recurrence_rule,
        location: r.location,
        visibility: r.visibility,
        privacy: r.privacy,
        reminders: r.reminders,
      } as unknown as Parameters<typeof createRoutine.mutate>[0])
    }
  }

  function onJoin() {
    const e = ctxEvent()
    if (e?.conferencing_url) window.open(e.conferencing_url, '_blank', 'noopener')
  }
  function onCopyMeetingLink() {
    const e = ctxEvent()
    if (e?.conferencing_url) void navigator.clipboard?.writeText(e.conferencing_url)
  }
  function onEmailAttendees() {
    const e = ctxEvent()
    const emails = (e?.attendees ?? []).map((a) => a.email)
    if (emails.length) window.location.href = `mailto:${emails.join(',')}`
  }

  function onCreate(type: 'event' | 'task' | 'routine') {
    openEditForm(null, type)
  }

  return {
    ctxItem,
    onEdit,
    onDelete,
    onDuplicate,
    onComplete,
    onSkip,
    onConvert,
    onSplit,
    onColorOverride,
    onJoin,
    onCopyMeetingLink,
    onEmailAttendees,
    onCreate,
  }
}
