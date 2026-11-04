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
 * A single item on the unified calendar (spec #22). `GET /api/events` unions
 * events, scheduled tasks, and routine instances in the window; the `kind`
 * discriminator tells them apart. Scheduled tasks carry their own
 * `scheduled_start`/`scheduled_end`; a split parent (scheduled_start null) is
 * naturally excluded — only its children render (#23e).
 */
export type CalendarItem =
  | (import('./event').CalendarEvent & { kind: 'event'; occurrence_start?: string })
  | (import('./task').Task & { kind: 'task' })
  | (RoutineInstanceItem & { kind: 'routine_instance' })

export interface ApiError {
  error: string
  message: string
  status: number
  details?: Record<string, string[]>
}
