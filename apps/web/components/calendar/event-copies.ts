import type { Calendar, CalendarEvent, EventAttendee } from '@poolendar/types'
import { ownResponse } from '@/lib/event-merge'

// One meeting can reach you as several copies: one per account it was sent to, or per
// calendar it sits on. The grid shows one (mergeDuplicateEventItems); these name the rest
// and say which copies you can answer from.

/** A copy you can reply from, and the account the reply goes out as. */
export interface RsvpCopy {
  eventId: string
  account: string
  response: EventAttendee['response_status']
}

/** Account id to its Google email. */
export type AccountEmails = Record<string, string>

/** The other copies of an event, on other calendars: the same iCalUID and start, or the same title and times. */
export function otherCopiesOf(event: CalendarEvent, events: CalendarEvent[]): CalendarEvent[] {
  const start = new Date(event.start_time).getTime()
  const end = new Date(event.end_time).getTime()
  return events.filter((other) => {
    if (other.id === event.id || other.calendar_id === event.calendar_id || other.status === 'cancelled') return false
    if (new Date(other.start_time).getTime() !== start) return false
    if (event.ical_uid && other.ical_uid === event.ical_uid) return true
    return other.title === event.title && new Date(other.end_time).getTime() === end
  })
}

function accountOf(event: CalendarEvent, calendars: Calendar[], accounts: AccountEmails): string | null {
  const accountId = calendars.find((c) => c.id === event.calendar_id)?.google_account_id
  return accountId ? accounts[accountId] ?? null : null
}

/**
 * What the "Also on" line calls each copy: its calendar, with the account added when two
 * of the copies' calendars share a name.
 */
export function copyLabels(copies: CalendarEvent[], calendars: Calendar[], accounts: AccountEmails): string[] {
  const names = copies.map((e) => calendars.find((c) => c.id === e.calendar_id)?.name ?? 'Calendar')
  return copies.map((e, i) => {
    const name = names[i]!
    const email = accountOf(e, calendars, accounts)
    return email && names.filter((n) => n === name).length > 1 ? `${name} (${email})` : name
  })
}

/** The copies on Google calendars where you're a guest, the shown copy first. */
export function rsvpCopies(copies: CalendarEvent[], calendars: Calendar[], accounts: AccountEmails): RsvpCopy[] {
  return copies.flatMap((event) => {
    const account = accountOf(event, calendars, accounts)
    const response = account ? ownResponse(event, account) : null
    return account && response ? [{ eventId: event.id, account, response }] : []
  })
}
