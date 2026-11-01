import type { EventAttendee } from '@poolendar/types'

// The parts of the Google Calendar v3 Event resource this app reads or writes.
// https://developers.google.com/calendar/api/v3/reference/events

export interface GoogleEventDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GoogleEventAttendee {
  email: string
  displayName?: string
  responseStatus?: EventAttendee['response_status']
}

export interface GoogleEventReminders {
  useDefault?: boolean
  overrides?: { method?: string; minutes: number }[]
}

export interface GoogleConferenceEntryPoint {
  entryPointType?: string
  uri?: string
}

export interface GoogleConferenceData {
  entryPoints?: GoogleConferenceEntryPoint[]
  createRequest?: {
    requestId: string
    conferenceSolutionKey: { type: string }
  }
}

/** Fields this app sends in a PATCH. Null clears a text field on Google's side. */
export interface GoogleEventWrite {
  summary?: string
  description?: string | null
  location?: string | null
  start?: GoogleEventDateTime
  end?: GoogleEventDateTime
  attendees?: GoogleEventAttendee[]
  reminders?: GoogleEventReminders
  recurrence?: string[]
  visibility?: string
  transparency?: string
  conferenceData?: GoogleConferenceData
  colorId?: string
}

/** Fields required to create an event. */
export interface GoogleEventInsert extends GoogleEventWrite {
  summary: string
  start: GoogleEventDateTime
  end: GoogleEventDateTime
}

/** An event as Google returns it. */
export interface GoogleEvent extends GoogleEventWrite {
  id: string
  etag?: string
  status?: string
  hangoutLink?: string
  recurringEventId?: string
  kind?: string
  htmlLink?: string
  created?: string
  updated?: string
  creator?: unknown
  organizer?: unknown
  iCalUID?: string
}

/** One page of an events.list response. */
export interface GoogleEventsPage {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}
