'use client'

import { useMemo, useCallback } from 'react'
import { parseISO, format, addDays } from 'date-fns'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { useUIStore } from '@/lib/stores/ui-store'
import { useMounted } from '@/lib/hooks/use-mounted'
import { CalendarHeader } from '@/components/calendar'
import { CalendarWorkspace } from '@/components/calendar/CalendarWorkspace'
import { EditFormHost } from '@/components/calendar/EditFormHost'
import { getVisibleDays } from '@/components/calendar/grid-helpers'
import { KanbanBoard } from '@/components/kanban'
import { UndoStrip } from '@/components/UndoStrip'
import { UpNextStrip } from '@/components/sidebar/UpNext'
import { useEvents, useRsvpEvent } from '@/lib/hooks/use-events'
import { useTasks } from '@/lib/hooks/use-tasks'
import { useUndoable } from '@/lib/hooks/use-undoable'
import { useRoutines } from '@/lib/hooks/use-routines'
import { useTags } from '@/lib/hooks/use-tags'
import { useCalendars, useCalendarAccounts } from '@/lib/hooks/use-calendars'
import { useProfile } from '@/lib/hooks/use-profile'
import type { TaskStatus, TaskBoard, TaskImportance } from '@poolendar/types'

export default function AppPage() {
  const {
    view,
    customDays,
    selectedDate,
    showWeekends,
    widenCurrentDay,
    dimPastEvents,
    showDeclinedEvents,
    showCompletedTasks,
    mergeDuplicateEvents,
    goToToday,
    goToPrevPeriod,
    goToNextPeriod,
    setView,
    setShowWeekends,
    setWidenCurrentDay,
    setDimPastEvents,
    setShowDeclinedEvents,
    setShowCompletedTasks,
    setMergeDuplicateEvents,
  } = useCalendarStore()

  const { taskPanelViewMode } = useUIStore()

  const currentDate = useMemo(
    () => parseISO(selectedDate + 'T00:00:00'),
    [selectedDate]
  )

  // Range covering every visible day of the current view (2-weeks / custom
  // included), padded to the end of the last day.
  const { start: viewStart, end: viewEnd } = useMemo(() => {
    const days = getVisibleDays(currentDate, view, customDays)
    const first = days[0] ?? currentDate
    const last = days[days.length - 1] ?? currentDate
    return {
      start: format(first, 'yyyy-MM-dd'),
      end: format(addDays(last, 1), 'yyyy-MM-dd'),
    }
  }, [currentDate, view, customDays])

  const { data: events = [] } = useEvents(viewStart, viewEnd)
  const { data: tasks = [] } = useTasks({})
  const { data: routines = [] } = useRoutines()
  const { data: tags = [] } = useTags()
  const { data: calendars = [] } = useCalendars()
  const { data: accounts = [] } = useCalendarAccounts()
  const { data: profile } = useProfile()

  const userId = profile?.id ?? null
  const selfEmails = useMemo(() => accounts.map((a) => a.email), [accounts])
  const accountEmails = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.email])), [accounts])
  const rsvp = useRsvpEvent()

  const undoable = useUndoable()

  // ---- Kanban interactions ----
  const handleTaskMove = useCallback(
    (taskId: string, newStatus: TaskStatus, newPosition: number) => {
      const prev = tasks.find((t) => t.id === taskId)
      if (!prev) return
      undoable.moveTask({ id: taskId, status: newStatus, position: newPosition }, prev)
    },
    [undoable, tasks]
  )

  const handleTaskReorder = useCallback(
    (taskId: string, status: TaskStatus, newPosition: number) => {
      const prev = tasks.find((t) => t.id === taskId)
      if (!prev) return
      undoable.reorderTask({ id: taskId, status, position: newPosition }, prev)
    },
    [undoable, tasks]
  )

  const handleTaskCreate = useCallback(
    (data: {
      title: string
      status: TaskStatus
      importance: TaskImportance
      due_date: string | null
      board: TaskBoard
    }) => {
      // No userId gate here on purpose. This used to `return` when the profile
      // query hadn't resolved, which silently threw the task away — the form
      // closed, the input cleared, and nothing was created or reported.
      // useCreateTask resolves the owner from the auth session when it's null.
      undoable.createTask({
        user_id: userId,
        calendar_id: null,
        parent_id: null,
        title: data.title,
        notes: null,
        importance: data.importance,
        time_estimate_minutes: null,
        earliest_start: null,
        due_date: data.due_date,
        due_date_recurrence: null,
        scheduled_start: null,
        scheduled_end: null,
        location: null,
        visibility: 'busy',
        privacy: 'private',
        flexibility: 'flexible',
        status: data.status,
        board: data.board,
        is_split: false,
        completed_at: null,
        position: null,
        reminders: [],
      })
    },
    [undoable, userId]
  )

  const { openEditForm } = useUIStore()
  const handleTaskClick = useCallback(
    (task: import('@poolendar/types').Task) => {
      openEditForm(task.id, 'task')
    },
    [openEditForm]
  )

  const handleTaskComplete = useCallback(
    (taskId: string) => {
      const prev = tasks.find((t) => t.id === taskId)
      if (!prev) return
      if (prev.status === 'done') undoable.reopenTask(prev)
      else undoable.completeTask(prev)
    },
    [undoable, tasks]
  )

  const showKanban = taskPanelViewMode === 'board'
  // The week, today's column and "This week" come from the viewer's date, which only the browser
  // knows: the server's date can differ by a day. So the dated views draw once mounted.
  const mounted = useMounted()
  if (!mounted) return <div className="flex h-full flex-col" aria-busy="true" />

  return (
    <div className="flex h-full flex-col">
      {/* The board brings its own header; the week gets the calendar header, then undo, then Up next on phones. */}
      {!showKanban && (
        <>
          <CalendarHeader
            currentDate={currentDate}
            view={view}
            customDays={customDays}
            onToday={goToToday}
            onPrev={goToPrevPeriod}
            onNext={goToNextPeriod}
            onViewChange={(v) => setView(v)}
            showWeekends={showWeekends}
            widenCurrentDay={widenCurrentDay}
            dimPastEvents={dimPastEvents}
            showDeclinedEvents={showDeclinedEvents}
            showCompletedTasks={showCompletedTasks}
            mergeDuplicateEvents={mergeDuplicateEvents}
            onShowWeekendsChange={setShowWeekends}
            onWidenCurrentDayChange={setWidenCurrentDay}
            onDimPastEventsChange={setDimPastEvents}
            onShowDeclinedEventsChange={setShowDeclinedEvents}
            onShowCompletedTasksChange={setShowCompletedTasks}
            onMergeDuplicateEventsChange={setMergeDuplicateEvents}
          />
          <UndoStrip />
          <UpNextStrip />
        </>
      )}

      {showKanban ? (
        <div className="flex-1 overflow-hidden">
          <KanbanBoard
            belowHeader={<UndoStrip />}
            tasks={tasks}
            tags={tags}
            onTaskMove={handleTaskMove}
            onTaskReorder={handleTaskReorder}
            onTaskCreate={handleTaskCreate}
            onTaskClick={handleTaskClick}
            onTaskComplete={handleTaskComplete}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <CalendarWorkspace
            events={events}
            tasks={tasks}
            routines={routines}
            calendars={calendars}
            selfEmails={selfEmails}
            userId={userId}
            currentDate={currentDate}
            accountEmails={accountEmails}
            onRsvp={(id, response) => rsvp.mutateAsync({ id, response })}
          />
        </div>
      )}

      {/* Globally-mounted edit form — opens from grid, kanban, keyboard, or menus */}
      <EditFormHost
        events={events}
        tasks={tasks}
        routines={routines}
        calendars={calendars}
        tags={tags}
        userId={userId}
        accountEmails={accountEmails}
      />
    </div>
  )
}
