export type SyncStatus = 'synced' | 'pending_push' | 'conflict'
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'

export interface EventAttendee {
  email: string
  name?: string
  response_status: 'needsAction' | 'accepted' | 'declined' | 'tentative'
}

export interface EventReminder {
  minutes_before: number
}

export interface CalendarEvent {
  id: string
  user_id: string
  calendar_id: string
  google_event_id: string | null
  title: string
  notes: string | null
  start_time: string
  end_time: string
  timezone: string
  is_all_day: boolean
  location: string | null
  color_override: string | null
  visibility: 'busy' | 'free'
  privacy: 'public' | 'private'
  conferencing_url: string | null
  recurrence_rule: string | null
  recurrence_id: string | null
  /** Occurrences removed from this series. */
  recurrence_exceptions?: string[] | null
  attendees: EventAttendee[]
  reminders: EventReminder[]
  status: EventStatus
  sync_status: SyncStatus
  etag: string | null
  created_at: string
  updated_at: string
}
