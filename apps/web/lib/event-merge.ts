import type { Calendar, CalendarEvent, EventAttendee } from '@poolendar/types'

// One meeting can reach a person as several copies: one per Google account it was sent
// to, or per calendar it sits on. The grid, the events API and search show it once, by
// the same rules, which live here. Runs in the browser and on the server.

/** What decides whether two items are copies of one meeting. */
export interface CopyFacts {
  calendarId: string
  icalUid: string | null | undefined
  title: string
  /** Epoch milliseconds. */
  start: number
  end: number
}

/** Your answer on a copy, best first. A copy that doesn't say ranks with needsAction. */
const ATTENDANCE: Record<string, number> = { accepted: 3, tentative: 2, needsAction: 1, declined: 0 }

/** How good a copy is to show: one you're going to, on a calendar you can edit. */
export function copyRank(
  event: Pick<CalendarEvent, 'attendees'>,
  calendar?: Pick<Calendar, 'source' | 'access_role' | 'is_primary'>
): number {
  const own = event.attendees?.find((a) => a.self)
  const writable = calendar?.source === 'local' || calendar?.access_role === 'owner' || calendar?.access_role === 'writer'
  return (ATTENDANCE[own?.response_status ?? 'needsAction'] ?? 1) * 4 + (writable ? 2 : 0) + (calendar?.is_primary ? 1 : 0)
}

/** Your answer on a copy: the guest Google marked as its account, else that account's email. */
export function ownResponse(
  event: Pick<CalendarEvent, 'attendees'>,
  accountEmail: string | null
): EventAttendee['response_status'] | null {
  const attendees = event.attendees ?? []
  const email = accountEmail?.toLowerCase()
  const own = attendees.find((a) => a.self) ?? attendees.find((a) => a.email.toLowerCase() === email)
  return own?.response_status ?? null
}

/**
 * Shows each meeting once. Copies match on iCalUID and start, which keeps the days of a
 * series apart, or failing that on title and exact times. Items on one calendar never
 * hide each other: in each match, the calendar holding the most copies shows its own,
 * the best-ranked first on a tie. Returns the items to show, in their original order,
 * and the copies each shown item hides. Items without facts pass through.
 */
export function mergeCopies<T>(
  items: T[],
  factsOf: (item: T) => CopyFacts | null,
  rank: (item: T) => number
): { shown: T[]; hidden: Map<T, T[]> } {
  const hidden = new Map<T, T[]>()

  const pass = (list: T[], keyOf: (facts: CopyFacts) => string | null): T[] => {
    const groups = new Map<string, Map<string, T[]>>()
    for (const item of list) {
      const facts = factsOf(item)
      const key = facts ? keyOf(facts) : null
      if (!facts || key === null) continue
      const byCalendar = groups.get(key) ?? new Map<string, T[]>()
      groups.set(key, byCalendar)
      byCalendar.set(facts.calendarId, [...(byCalendar.get(facts.calendarId) ?? []), item])
    }

    const gone = new Set<T>()
    for (const byCalendar of groups.values()) {
      if (byCalendar.size < 2) continue
      const best = (group: T[]) => Math.max(...group.map(rank))
      const [kept, ...rest] = [...byCalendar.values()].sort((a, b) => b.length - a.length || best(b) - best(a))
      for (const group of rest) {
        group.forEach((item, index) => {
          gone.add(item)
          const host = kept![Math.min(index, kept!.length - 1)]!
          hidden.set(host, [...(hidden.get(host) ?? []), item, ...(hidden.get(item) ?? [])])
          hidden.delete(item)
        })
      }
    }
    return gone.size ? list.filter((item) => !gone.has(item)) : list
  }

  const sameMeeting = pass(items, (f) => (f.icalUid ? `${f.icalUid}|${f.start}` : null))
  return { shown: pass(sameMeeting, (f) => `${f.title}|${f.start}|${f.end}`), hidden }
}
