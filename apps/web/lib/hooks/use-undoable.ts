'use client'

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Calendar, CalendarEvent, Task, Routine, RoutineInstanceStatus } from '@poolendar/types'
import { ruleEndingBefore } from '@/lib/recurrence'
import { useUndoContext } from '@/lib/undo/undo-context'
import {
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  eventKeys,
  defaultCalendarId,
  type CreateEventInput,
  type UpdateEventInput,
} from './use-events'
import { calendarKeys, defaultCalendarOf } from './use-calendars'
import { createClient } from '@/lib/supabase/client'
import { sessionUserId } from '@/lib/auth/session-ready'
import {
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useCompleteTask,
  useMoveTask,
  useScheduleTask,
  taskKeys,
  type CreateTaskInput,
  type UpdateTaskInput,
  type MoveTaskInput,
} from './use-tasks'
import {
  useCreateRoutine,
  useUpdateRoutine,
  useDeleteRoutine,
  useCompleteRoutineInstance,
  useResetRoutineInstance,
  useSkipRoutineInstance,
  routineKeys,
} from './use-routines'
import type { CreateRoutineInput, UpdateRoutineInput } from './use-routines'
import { unloadCommits } from '@/lib/undo/unload-commit'

/** Which occurrences a routine delete covers: the same choices as a recurring event. */
export type RoutineDeleteScope =
  | { type: 'single' }
  | { type: 'future' }
  | { type: 'all' }
  | { type: 'custom'; dates: string[] }

// ---------------------------------------------------------------------------
// use-undoable — the single entry point the UI uses for mutations so every
// change is recorded on the shared undo stack (#72d-f). Destructive ops
// (delete / complete / move) are held for the grace window, applied
// optimistically now and committed to the server only after it elapses; a
// cancel during the window restores the snapshot. Non-destructive ops
// (create / update / schedule / reorder) run immediately but leave a stack
// entry so ⌘Z reverts them.
// ---------------------------------------------------------------------------

type Snapshot = [readonly unknown[], unknown][]

function snap(qc: QueryClient, key: readonly unknown[]): Snapshot {
  return qc.getQueriesData({ queryKey: key }) as Snapshot
}

function restore(qc: QueryClient, s: Snapshot) {
  for (const [k, d] of s) qc.setQueryData(k, d)
}

function removeFromLists(qc: QueryClient, key: readonly unknown[], id: string) {
  qc.setQueriesData({ queryKey: key }, (old: unknown) =>
    Array.isArray(old) ? (old as { id: string }[]).filter((i) => i.id !== id) : old
  )
}

function patchInLists(
  qc: QueryClient,
  key: readonly unknown[],
  id: string,
  patch: Record<string, unknown>
) {
  qc.setQueriesData({ queryKey: key }, (old: unknown) =>
    Array.isArray(old)
      ? (old as { id: string }[]).map((i) => (i.id === id ? { ...i, ...patch } : i))
      : old
  )
}

/** The subset of `source` covering exactly the keys present in `patch`. */
function revertOf<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(patch) as (keyof T)[]) out[k] = source[k]
  return out
}

export function useUndoable() {
  const qc = useQueryClient()
  const { pushOperation } = useUndoContext()

  const createEventM = useCreateEvent()
  const updateEventM = useUpdateEvent()
  const deleteEventM = useDeleteEvent()
  const createTaskM = useCreateTask()
  const updateTaskM = useUpdateTask()
  const deleteTaskM = useDeleteTask()
  const completeTaskM = useCompleteTask()
  const moveTaskM = useMoveTask()
  const scheduleTaskM = useScheduleTask()
  const createRoutineM = useCreateRoutine()
  const updateRoutineM = useUpdateRoutine()
  const deleteRoutineM = useDeleteRoutine()
  const completeInstanceM = useCompleteRoutineInstance()
  const resetInstanceM = useResetRoutineInstance()
  const skipInstanceM = useSkipRoutineInstance()

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  function createEvent(event: CreateEventInput) {
    // The id is chosen here so the write and its resend on unload are the same row, and the
    // calendar from what the page already loaded, so the resend is a complete row from the start.
    const input = {
      ...event,
      id: event.id ?? crypto.randomUUID(),
      calendar_id: event.calendar_id ?? defaultCalendarOf(qc.getQueryData<Calendar[]>(calendarKeys.list())),
    }
    let createdId: string | null = null
    pushOperation({
      type: 'create',
      entityType: 'event',
      entityId: input.id,
      previousState: null,
      newState: input as Record<string, unknown>,
      commitOnUnload: unloadCommits.createEvent(input),
      execute: async () => {
        // The calendar list hadn't loaded yet: ask for the default before anything else, so a
        // reload from here on still resends a complete row.
        if (!input.calendar_id) {
          const supabase = createClient()
          input.calendar_id = await defaultCalendarId(supabase, input.user_id ?? (await sessionUserId(supabase)))
        }
        const created = await createEventM.mutateAsync(input)
        createdId = created.id
      },
      rollback: () => {
        if (createdId) deleteEventM.mutate(createdId)
      },
    })
  }

  function updateEvent(
    id: string,
    patch: UpdateEventInput['data'],
    previous: CalendarEvent
  ) {
    const revert = revertOf(previous, patch)
    pushOperation({
      type: 'update',
      entityType: 'event',
      entityId: id,
      previousState: previous as unknown as Record<string, unknown>,
      newState: patch as Record<string, unknown>,
      execute: async () => {
        await updateEventM.mutateAsync({ id, data: patch })
      },
      rollback: () => updateEventM.mutate({ id, data: revert }),
    })
  }

  function deleteEvent(event: CalendarEvent) {
    const snapshot = snap(qc, eventKeys.lists())
    removeFromLists(qc, eventKeys.lists(), event.id)
    pushOperation({
      type: 'delete',
      entityType: 'event',
      entityId: event.id,
      previousState: event as unknown as Record<string, unknown>,
      newState: null,
      execute: () => deleteEventM.mutateAsync(event.id),
      commitOnUnload: unloadCommits.deleteEvent(event.id),
      rollback: () => restore(qc, snapshot),
    })
  }

  // -----------------------------------------------------------------------
  // Tasks
  // -----------------------------------------------------------------------

  function createTask(task: CreateTaskInput) {
    const input = { ...task, id: task.id ?? crypto.randomUUID() }
    let createdId: string | null = null
    pushOperation({
      type: 'create',
      entityType: 'task',
      entityId: input.id,
      previousState: null,
      newState: input as Record<string, unknown>,
      commitOnUnload: unloadCommits.createTask(input),
      execute: async () => {
        const created = await createTaskM.mutateAsync(input)
        createdId = created.id
      },
      rollback: () => {
        if (createdId) deleteTaskM.mutate(createdId)
      },
    })
  }

  function updateTask(id: string, patch: UpdateTaskInput['data'], previous: Task) {
    const revert = revertOf(previous, patch as Partial<Task>)
    pushOperation({
      type: 'update',
      entityType: 'task',
      entityId: id,
      previousState: previous as unknown as Record<string, unknown>,
      newState: patch as Record<string, unknown>,
      execute: async () => {
        await updateTaskM.mutateAsync({ id, data: patch })
      },
      rollback: () => updateTaskM.mutate({ id, data: revert as UpdateTaskInput['data'] }),
    })
  }

  function scheduleTask(
    id: string,
    scheduled_start: string,
    scheduled_end: string,
    previous: Task
  ) {
    pushOperation({
      type: 'update',
      entityType: 'task',
      entityId: id,
      previousState: previous as unknown as Record<string, unknown>,
      newState: { scheduled_start, scheduled_end },
      execute: async () => {
        await scheduleTaskM.mutateAsync({ id, scheduled_start, scheduled_end })
      },
      rollback: () =>
        updateTaskM.mutate({
          id,
          data: {
            scheduled_start: previous.scheduled_start,
            scheduled_end: previous.scheduled_end,
          },
        }),
    })
  }

  function deleteTask(task: Task) {
    const snapshot = snap(qc, taskKeys.lists())
    removeFromLists(qc, taskKeys.lists(), task.id)
    pushOperation({
      type: 'delete',
      entityType: 'task',
      entityId: task.id,
      previousState: task as unknown as Record<string, unknown>,
      newState: null,
      execute: () => deleteTaskM.mutateAsync(task.id),
      commitOnUnload: unloadCommits.deleteTask(task.id),
      rollback: () => restore(qc, snapshot),
    })
  }

  function completeTask(task: Task) {
    const snapshot = snap(qc, taskKeys.lists())
    patchInLists(qc, taskKeys.lists(), task.id, {
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    pushOperation({
      type: 'complete',
      entityType: 'task',
      entityId: task.id,
      previousState: task as unknown as Record<string, unknown>,
      newState: { status: 'done' },
      execute: async () => {
        await completeTaskM.mutateAsync(task.id)
      },
      commitOnUnload: unloadCommits.completeTask(task.id),
      rollback: () => restore(qc, snapshot),
    })
  }

  /** Reopen a done task (non-destructive — no grace window). */
  function reopenTask(task: Task) {
    pushOperation({
      type: 'update',
      entityType: 'task',
      entityId: task.id,
      previousState: task as unknown as Record<string, unknown>,
      newState: { status: 'backlog' },
      execute: async () => {
        await moveTaskM.mutateAsync({ id: task.id, status: 'backlog' })
      },
      rollback: () => moveTaskM.mutate({ id: task.id, status: task.status }),
    })
  }

  /** Cross-column kanban move (#41) — destructive, grace window. */
  function moveTask(input: MoveTaskInput, previous: Task) {
    const snapshot = snap(qc, taskKeys.lists())
    const optimistic: Record<string, unknown> = { status: input.status }
    if (input.board !== undefined) optimistic.board = input.board
    if (input.position !== undefined) optimistic.position = input.position
    if (input.status === 'done') optimistic.completed_at = new Date().toISOString()
    if (input.status !== 'done') optimistic.completed_at = null
    patchInLists(qc, taskKeys.lists(), input.id, optimistic)
    pushOperation({
      type: 'move',
      entityType: 'task',
      entityId: input.id,
      previousState: previous as unknown as Record<string, unknown>,
      newState: input as unknown as Record<string, unknown>,
      execute: async () => {
        await moveTaskM.mutateAsync(input)
      },
      commitOnUnload: unloadCommits.moveTask(input, previous),
      rollback: () => restore(qc, snapshot),
    })
  }

  /** Same-column reorder — non-destructive. */
  function reorderTask(input: MoveTaskInput, previous: Task) {
    pushOperation({
      type: 'update',
      entityType: 'task',
      entityId: input.id,
      previousState: previous as unknown as Record<string, unknown>,
      newState: input as unknown as Record<string, unknown>,
      execute: async () => {
        await moveTaskM.mutateAsync(input)
      },
      rollback: () =>
        moveTaskM.mutate({
          id: input.id,
          status: previous.status,
          position: previous.position ?? undefined,
        }),
    })
  }

  function splitTask(id: string) {
    pushOperation({
      type: 'update',
      entityType: 'task',
      entityId: id,
      previousState: null,
      newState: { split: true },
      execute: async () => {
        const res = await fetch(`/api/tasks/${id}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) throw new Error('split failed')
        qc.invalidateQueries({ queryKey: taskKeys.all })
      },
      rollback: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
    })
  }

  // -----------------------------------------------------------------------
  // Routines
  // -----------------------------------------------------------------------

  function createRoutine(routine: CreateRoutineInput & { user_id?: string | null }) {
    const input = { ...routine, id: routine.id ?? crypto.randomUUID() }
    let createdId: string | null = null
    pushOperation({
      type: 'create',
      entityType: 'routine',
      entityId: input.id,
      previousState: null,
      newState: input as Record<string, unknown>,
      commitOnUnload: unloadCommits.createRoutine(input),
      execute: async () => {
        const created = await createRoutineM.mutateAsync(input)
        createdId = created.id
      },
      rollback: () => {
        if (createdId) deleteRoutineM.mutate(createdId)
      },
    })
  }

  function updateRoutine(
    id: string,
    patch: UpdateRoutineInput['data'],
    previous: Routine
  ) {
    const revert = revertOf(previous, patch)
    pushOperation({
      type: 'update',
      entityType: 'routine',
      entityId: id,
      previousState: previous as unknown as Record<string, unknown>,
      newState: patch as Record<string, unknown>,
      execute: async () => {
        await updateRoutineM.mutateAsync({ id, data: patch })
      },
      rollback: () => updateRoutineM.mutate({ id, data: revert }),
    })
  }

  function deleteRoutine(routine: Routine) {
    const snapshot = snap(qc, routineKeys.lists())
    removeFromLists(qc, routineKeys.lists(), routine.id)
    pushOperation({
      type: 'delete',
      entityType: 'routine',
      entityId: routine.id,
      previousState: routine as unknown as Record<string, unknown>,
      newState: null,
      execute: () => deleteRoutineM.mutateAsync(routine.id),
      commitOnUnload: unloadCommits.deleteRoutine(routine.id),
      rollback: () => restore(qc, snapshot),
    })
  }

  function completeRoutineInstance(routineId: string, date: string) {
    const snapshot = snap(qc, routineKeys.allInstances())
    pushOperation({
      type: 'complete',
      entityType: 'routine',
      entityId: routineId,
      previousState: { routine_id: routineId, date },
      newState: { status: 'completed' },
      execute: async () => {
        await completeInstanceM.mutateAsync({ routine_id: routineId, date })
      },
      commitOnUnload: unloadCommits.completeRoutineInstance(routineId, date),
      rollback: () => {
        restore(qc, snapshot)
        resetInstanceM.mutate({ routine_id: routineId, date })
      },
    })
  }

  function resetRoutineInstance(routineId: string, date: string) {
    resetInstanceM.mutate({ routine_id: routineId, date })
  }

  /** Skip dates of a routine; undo returns each to its state before (done, or pending). */
  function skipRoutineDates(routineId: string, dates: string[], previousStatus?: RoutineInstanceStatus) {
    const snapshot = snap(qc, routineKeys.allInstances())
    const before = previousStatus === 'completed' ? 'completed' : 'pending'
    pushOperation({
      type: 'update',
      entityType: 'routine',
      entityId: routineId,
      previousState: { dates, status: before },
      newState: { dates, status: 'skipped' },
      execute: async () => {
        await Promise.all(dates.map((date) => skipInstanceM.mutateAsync({ routine_id: routineId, date })))
      },
      rollback: () => {
        restore(qc, snapshot)
        const back = before === 'completed' ? completeInstanceM : resetInstanceM
        for (const date of dates) back.mutate({ routine_id: routineId, date })
      },
    })
  }

  function skipRoutineInstance(routineId: string, date: string, previousStatus?: RoutineInstanceStatus) {
    skipRoutineDates(routineId, [date], previousStatus)
  }

  /**
   * Delete part or all of a routine, with the same scopes as a recurring event:
   * "only this" (and custom dates) skips those dates, "this and all future" ends the routine the
   * day before, "all" deletes it. Every case can be undone.
   */
  function deleteRoutineOccurrences(
    routine: Routine,
    date: string | null,
    scope: RoutineDeleteScope = { type: 'all' },
    previousStatus?: RoutineInstanceStatus
  ) {
    if (scope.type === 'all') {
      deleteRoutine(routine)
      return
    }
    if (scope.type === 'future') {
      if (!date) return
      // A routine counts from the day it was made, so from that day on "the rest" is all of it.
      if (date <= routine.created_at.slice(0, 10)) {
        deleteRoutine(routine)
        return
      }
      const before = new Date(`${date}T00:00:00.000Z`)
      updateRoutine(routine.id, { recurrence_rule: ruleEndingBefore(routine.recurrence_rule, before) }, routine)
      return
    }
    // Without a date there is no occurrence to remove; never fall through to deleting everything.
    const dates = scope.type === 'custom' ? scope.dates : date ? [date] : []
    if (dates.length > 0) skipRoutineDates(routine.id, dates, previousStatus)
  }

  return {
    createEvent,
    updateEvent,
    deleteEvent,
    createTask,
    updateTask,
    scheduleTask,
    deleteTask,
    completeTask,
    reopenTask,
    moveTask,
    reorderTask,
    splitTask,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    deleteRoutineOccurrences,
    completeRoutineInstance,
    resetRoutineInstance,
    skipRoutineInstance,
  }
}

export type UndoableActions = ReturnType<typeof useUndoable>
