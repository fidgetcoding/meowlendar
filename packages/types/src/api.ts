export type ConvertDirection =
  | 'event_to_task'
  | 'event_to_routine'
  | 'task_to_event'
  | 'task_to_routine'
  | 'routine_to_task'
  | 'routine_to_event'

export interface ConvertRequest {
  source_type: 'event' | 'task' | 'routine'
  source_id: string
  target_type: 'event' | 'task' | 'routine'
  calendar_id?: string
  repeat_pattern?: string
}

export interface SearchResult {
  type: 'event' | 'task' | 'routine' | 'booking_link'
  id: string
  title: string
  date: string | null
  snippet: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  cursor: string | null
  has_more: boolean
  total_count: number
}

/**
 * Cursor-paginated list envelope (spec #76). Every list endpoint returns this.
 * `next_cursor` is an opaque, base64url token; null when there are no more pages.
 * With no `cursor`/`limit` params the full set is returned in `items` and
 * `next_cursor` is null (backward-compatible content, enveloped shape).
 */
export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}

export type CalendarItemKind = 'event' | 'task' | 'routine_instance'

/**
 * A materialized routine occurrence, normalized for the calendar grid. Produced
 * by the events date-range query when routine instances fall inside the window.
 */
export interface RoutineInstanceItem {
  id: string
  routine_id: string
  date: string
  status: string
  title: string
  scheduled_start: string
  scheduled_end: string
  timezone: string
  calendar_id: string | null
}

/**
 * Another copy of a meeting that reached you through a different calendar or Google
 * account. `GET /api/events` shows each meeting once and lists the copies it left out
 * here; reply as that account with `POST /api/events/{event_id}/rsvp`.
 */
export interface EventCopyRef {
  event_id: string
  calendar_id: string
  /** The Google account the copy came through; null on a local calendar. */
  account_email: string | null
  google_event_id: string | null
  /** Your answer on that copy; null when that account isn't a guest. */
  response_status: import('./event').EventAttendee['response_status'] | null
}

/**
 * A single item on the unified calendar (spec #22). `GET /api/events` unions
 * events, scheduled tasks, and routine instances in the window; the `kind`
 * discriminator tells them apart. Scheduled tasks carry their own
 * `scheduled_start`/`scheduled_end`; a split parent (scheduled_start null) is
 * naturally excluded — only its children render (#23e).
 */
export type CalendarItem =
  | (import('./event').CalendarEvent & {
      kind: 'event'
      occurrence_start?: string
      /** Copies of this meeting merged into it. Absent with `merge=false` or when there are none. */
      also_on?: EventCopyRef[]
    })
  | (import('./task').Task & { kind: 'task' })
  | (RoutineInstanceItem & { kind: 'routine_instance' })

export interface ApiError {
  error: string
  message: string
  status: number
  details?: Record<string, string[]>
}
