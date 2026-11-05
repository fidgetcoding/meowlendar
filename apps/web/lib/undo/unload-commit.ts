import type { Task } from '@poolendar/types'
import type { CreateEventInput } from '@/lib/hooks/use-events'
import type { CreateTaskInput } from '@/lib/hooks/use-tasks'
import type { CreateRoutineInput } from '@/lib/hooks/use-routines'

// Committing a pending (grace-window) operation, or a create still in flight, while the page
// unloads.
//
// The normal path runs through the Supabase client, which the browser aborts on unload, and the
// event delete even starts with a read. Here each operation is the single final write to the app's
// own API route, sent with keepalive so the browser delivers it after the page is gone. Same-origin
// requests carry the session cookie, which is how the routes authenticate a browser.

interface KeepaliveRequest {
  path: string
  method: 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
}

export function sendKeepalive(...requests: KeepaliveRequest[]): void {
  for (const { path, method, body } of requests) {
    void fetch(path, {
      method,
      keepalive: true,
      credentials: 'same-origin',
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    }).catch(() => {
      // Nothing is left to report to: the page is going away.
    })
  }
}

const id = (value: string) => encodeURIComponent(value)

/** Keeps the keys that are set, so the API's own defaults apply to the rest. */
function present(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
}

export const unloadCommits = {
  // Creates resend the row with the id the page already chose. If the first write got there too,
  // the API sees that id and does nothing, so a resend never makes a second copy. Each body is
  // what the route validates for a normal create (see __tests__/unload-commit-schema.test.ts).
  // The calendar is read when the page goes, since it may only have been resolved after the create
  // began; without one there is no row the API would accept, so nothing is sent.
  createEvent: (e: CreateEventInput & { id: string }) => () => {
    if (!e.calendar_id) return
    sendKeepalive({
      path: '/api/events',
      method: 'POST',
      body: present({
        id: e.id,
        calendar_id: e.calendar_id,
        title: e.title,
        notes: e.notes,
        start_time: e.start_time,
        end_time: e.end_time,
        timezone: e.timezone,
        is_all_day: e.is_all_day,
        location: e.location,
        color_override: e.color_override,
        visibility: e.visibility,
        privacy: e.privacy,
        recurrence_rule: e.recurrence_rule,
        attendees: (e.attendees ?? []).map(({ email, name }) => present({ email, name: name ?? undefined })),
        reminders: e.reminders,
      }),
    })
  },

  createTask: (t: CreateTaskInput & { id: string }) => () =>
    sendKeepalive({
      path: '/api/tasks',
      method: 'POST',
      body: present({
        id: t.id,
        title: t.title,
        notes: t.notes,
        calendar_id: t.calendar_id,
        importance: t.importance,
        time_estimate_minutes: t.time_estimate_minutes,
        earliest_start: t.earliest_start,
        due_date: t.due_date,
        due_date_recurrence: t.due_date_recurrence,
        scheduled_start: t.scheduled_start,
        scheduled_end: t.scheduled_end,
        location: t.location,
        visibility: t.visibility,
        privacy: t.privacy,
        flexibility: t.flexibility,
        status: t.status,
        board: t.board,
        completed_at: t.completed_at,
        reminders: t.reminders,
        tag_ids: t.tag_ids,
      }),
    }),

  createRoutine: (r: CreateRoutineInput & { id: string }) => () =>
    sendKeepalive({
      path: '/api/routines',
      method: 'POST',
      body: present({
        id: r.id,
        title: r.title,
        notes: r.notes,
        calendar_id: r.calendar_id,
        start_time: r.start_time.slice(0, 5),
        end_time: r.end_time.slice(0, 5),
        timezone: r.timezone,
        recurrence_rule: r.recurrence_rule,
        location: r.location,
        visibility: r.visibility,
        privacy: r.privacy,
        reminders: r.reminders,
      }),
    }),

  deleteEvent: (eventId: string) => () =>
    sendKeepalive({ path: `/api/events/${id(eventId)}`, method: 'DELETE' }),

  deleteTask: (taskId: string) => () =>
    sendKeepalive({ path: `/api/tasks/${id(taskId)}`, method: 'DELETE' }),

  completeTask: (taskId: string) => () =>
    sendKeepalive({ path: `/api/tasks/${id(taskId)}/complete`, method: 'POST' }),

  /**
   * A board move. Like the in-app move, starting a task with no time puts it on the calendar now;
   * the task we already hold says whether it had one, so no read is needed.
   */
  moveTask: (input: { id: string; status?: Task['status']; board?: Task['board']; position?: number }, previous: Pick<Task, 'scheduled_start'>) => () => {
    const { id: taskId, ...move } = input
    const requests: KeepaliveRequest[] = [{ path: `/api/tasks/${id(taskId)}/move`, method: 'POST', body: move }]
    if (input.status === 'in_progress' && !previous.scheduled_start) {
      requests.push({ path: `/api/tasks/${id(taskId)}`, method: 'PATCH', body: { scheduled_start: new Date().toISOString() } })
    }
    sendKeepalive(...requests)
  },

  deleteRoutine: (routineId: string) => () =>
    sendKeepalive({ path: `/api/routines/${id(routineId)}`, method: 'DELETE' }),

  completeRoutineInstance: (routineId: string, date: string) => () =>
    sendKeepalive({ path: `/api/routines/${id(routineId)}/instances/${id(date)}`, method: 'PATCH', body: { status: 'completed' } }),
}
