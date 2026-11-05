import { describe, it, expect } from 'vitest'
import type { Calendar, CalendarEvent } from '@poolendar/types'
import { mapGoogleEventToLocal } from '../sync'
import type { GoogleEvent } from '../types'
import { eventsToItems } from '@/components/calendar/grid-items'
import { isDeclinedEvent, mergeDuplicateEventItems } from '@/components/calendar/grid-helpers'

// What the grid shows for events as Google sends them to each connected account:
// mapped like the sync maps them, expanded, merged, then declined ones dropped.

const WINDOW = { start: new Date('2030-01-07T00:00:00Z'), end: new Date('2030-01-14T00:00:00Z') }
const A = 'nate@work.test'
const B = 'nate@home.test'

function calendar(id: string, extra: Partial<Calendar> = {}): Calendar {
  return {
    id,
    user_id: 'user-1',
    google_account_id: `account-${id}`,
    google_calendar_id: id,
    source: 'google',
    name: id,
    color: '#3b82f6',
    is_primary: true,
    is_active: true,
    access_role: 'owner',
    created_at: '',
    updated_at: '',
    ...extra,
  }
}

let seq = 0
function stored(google: GoogleEvent, calendarId: string): CalendarEvent {
  return { ...mapGoogleEventToLocal(google, calendarId, 'user-1'), id: `row-${++seq}`, created_at: '', updated_at: '' } as CalendarEvent
}

function meeting(id: string, extra: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id,
    iCalUID: `${id}@google.com`,
    summary: 'Kickoff',
    start: { dateTime: '2030-01-08T10:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2030-01-08T11:00:00Z', timeZone: 'UTC' },
    ...extra,
  }
}

/** Each account's copy lists every guest and marks its own. */
function guests(self: string, answers: Record<string, 'accepted' | 'declined' | 'needsAction'>) {
  return Object.entries(answers).map(([email, responseStatus]) => ({ email, responseStatus, ...(email === self ? { self: true } : {}) }))
}

function shown(events: CalendarEvent[], calendars: Calendar[]) {
  return mergeDuplicateEventItems(eventsToItems(events, calendars, WINDOW), calendars)
    .filter((i) => !(i.event && isDeclinedEvent(i.event, [A, B])))
}

describe('several accounts on the grid', () => {
  const work = calendar('work')
  const home = calendar('home')

  it('shows a meeting invited to two accounts once, with the other copy kept on it', () => {
    const items = shown([stored(meeting('kickoff'), work.id), stored(meeting('kickoff'), home.id)], [work, home])
    expect(items).toHaveLength(1)
    expect(items[0]!.duplicates?.map((d) => d.event?.calendar_id)).toEqual([home.id])
  })

  it('matches an invite from another calendar system by iCalUID, though each account gave it its own id', () => {
    const uid = { iCalUID: 'vendor-123@outlook.test' }
    const items = shown(
      [stored(meeting('vendora1', { ...uid, summary: 'Vendor call' }), work.id), stored(meeting('vendorb1', { ...uid, summary: 'Vendor call (Acme)' }), home.id)],
      [work, home],
    )
    expect(items).toHaveLength(1)
  })

  it('shows the copy you accepted when you declined it on your other account', () => {
    const answers = { [A]: 'accepted', [B]: 'declined' } as const
    const items = shown(
      [stored(meeting('kickoff', { attendees: guests(B, answers) }), home.id), stored(meeting('kickoff', { attendees: guests(A, answers) }), work.id)],
      [work, home],
    )
    expect(items.map((i) => i.event?.calendar_id)).toEqual([work.id])
  })

  it('hides a meeting declined on every account it reached', () => {
    const answers = { [A]: 'declined', [B]: 'declined' } as const
    const items = shown(
      [stored(meeting('kickoff', { attendees: guests(A, answers) }), work.id), stored(meeting('kickoff', { attendees: guests(B, answers) }), home.id)],
      [work, home],
    )
    expect(items).toEqual([])
  })

  it('shows a calendar shared with both accounts once', () => {
    const teamA = calendar('team-a', { is_primary: false, access_role: 'reader' })
    const teamB = calendar('team-b', { is_primary: false })
    const items = shown([stored(meeting('standup'), teamA.id), stored(meeting('standup'), teamB.id)], [teamA, teamB])
    expect(items).toHaveLength(1)
    // The copy shown is the one on the calendar you can edit.
    expect(items[0]!.event?.calendar_id).toBe(teamB.id)
  })

  it('keeps every day of a series that reached two accounts, once each', () => {
    const series = meeting('daily', { recurrence: ['RRULE:FREQ=DAILY;COUNT=5'] })
    const items = shown([stored(series, work.id), stored(series, home.id)], [work, home])
    expect(items.map((i) => i.startTime.toISOString())).toEqual([8, 9, 10, 11, 12].map((d) => `2030-01-${String(d).padStart(2, '0')}T10:00:00.000Z`))
  })

  it('never merges two events on one calendar, even with one iCalUID and start', () => {
    // A series occurrence moved onto the time of another one, for instance.
    const series = stored(meeting('daily', { recurrence: ['RRULE:FREQ=DAILY;COUNT=3'] }), work.id)
    const moved = stored(meeting('daily_20300108T100000Z', {
      iCalUID: 'daily@google.com',
      recurringEventId: 'daily',
      start: { dateTime: '2030-01-09T10:00:00Z' },
      end: { dateTime: '2030-01-09T11:00:00Z' },
    }), work.id)
    series.recurrence_exceptions = ['2030-01-08T10:00:00.000Z']
    expect(shown([series, moved], [work]).map((i) => i.startTime.toISOString())).toEqual([
      '2030-01-09T10:00:00.000Z',
      '2030-01-10T10:00:00.000Z',
      '2030-01-09T10:00:00.000Z',
    ])
  })
})
