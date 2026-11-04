import { RRule } from 'rrule'

// Expands recurring events into the occurrences that fall inside a window. Runs in
// the browser (grid) and on the server (API, reminders, booking availability).
//
// Rules are evaluated in the event's own wall clock, so "every day at 9am" stays at
// 9am across a daylight saving change rather than drifting by an hour.

export interface RecurringSource {
  start_time: string
  end_time: string
  timezone?: string | null
  is_all_day?: boolean | null
  recurrence_rule?: string | null
  recurrence_exceptions?: string[] | null
}

export interface Occurrence {
  start: Date
  end: Date
}

const MAX_OCCURRENCES_PER_WINDOW = 1000
const DAY_MS = 24 * 60 * 60 * 1000

function ruleText(rule: string): string {
  return rule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^RRULE:/i, ''))
    .join(';')
}

export function isValidRecurrenceRule(rule: string): boolean {
  if (rule.length > 1000) return false
  try {
    const options = RRule.parseString(ruleText(rule))
    if (options.freq === undefined) return false
    if (options.interval != null && (!Number.isInteger(options.interval) || options.interval <= 0)) return false
    if (options.count != null && (!Number.isInteger(options.count) || options.count <= 0)) return false
    // Construction validates fields such as frequency and BYSETPOS without iterating.
    new RRule(options)
    return true
  } catch {
    return false
  }
}

// A visible month expands many occurrences in the same few zones. Reuse the
// expensive Intl formatter, with a bound for long-running server processes.
const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!)
  formatters.set(timeZone, formatter)
  return formatter
}

/** The instant's wall clock in `timeZone`, expressed as if it were UTC. */
function toWallClock(date: Date, timeZone: string): Date {
  const parts = formatterFor(timeZone).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return new Date(
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')),
  )
}

/** The instant whose wall clock in `timeZone` matches `wall`. */
function fromWallClock(wall: Date, timeZone: string): Date {
  const guess = new Date(wall.getTime() - (toWallClock(wall, timeZone).getTime() - wall.getTime()))
  const offset = toWallClock(guess, timeZone).getTime() - guess.getTime()
  return new Date(wall.getTime() - offset)
}

function safeZone(timeZone: string | null | undefined, allDay: boolean): string {
  if (allDay || !timeZone) return 'UTC'
  try {
    formatterFor(timeZone)
    return timeZone
  } catch {
    return 'UTC'
  }
}

/** Occurrences of `event` overlapping [windowStart, windowEnd], skipping exceptions. */
export function expandOccurrences(
  event: RecurringSource,
  windowStart: Date,
  windowEnd: Date,
): Occurrence[] {
  const start = new Date(event.start_time)
  const end = new Date(event.end_time)
  const durationMs = end.getTime() - start.getTime()
  const overlaps = (s: Date, e: Date) => s <= windowEnd && e >= windowStart

  if (!event.recurrence_rule || !isValidRecurrenceRule(event.recurrence_rule)) {
    return overlaps(start, end) ? [{ start, end }] : []
  }

  const zone = safeZone(event.timezone, Boolean(event.is_all_day))
  const skipped = new Set(
    (event.recurrence_exceptions ?? []).map((iso) => new Date(iso).getTime()),
  )

  const options = RRule.parseString(ruleText(event.recurrence_rule))
  // UNTIL is an instant, but the rule runs on the wall clock here.
  if (options.until) options.until = toWallClock(options.until, zone)
  const rule = new RRule({ ...options, dtstart: toWallClock(start, zone) })

  // A day of margin on each side covers any time zone offset.
  const wallFrom = new Date(toWallClock(windowStart, zone).getTime() - durationMs - DAY_MS)
  const wallTo = new Date(toWallClock(windowEnd, zone).getTime() + DAY_MS)

  const occurrences: Occurrence[] = []
  // Stop RRule's iterator before it allocates the entire candidate window.
  rule.between(wallFrom, wallTo, true, (wall) => {
    const s = fromWallClock(wall, zone)
    if (skipped.has(s.getTime())) return true
    const e = new Date(s.getTime() + durationMs)
    if (overlaps(s, e)) occurrences.push({ start: s, end: e })
    return occurrences.length < MAX_OCCURRENCES_PER_WINDOW
  })
  return occurrences
}

/** The instant a wall-clock date and time means in `timeZone`. */
export function wallClockToInstant(date: string, time: string, timeZone: string): Date {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number)
  return fromWallClock(new Date(Date.UTC(year, month - 1, day, hour, minute)), safeZone(timeZone, false))
}

/** The YYYY-MM-DD date of an instant in `timeZone`. */
export function dateInZone(instant: Date, timeZone: string): string {
  return toWallClock(instant, safeZone(timeZone, false)).toISOString().slice(0, 10)
}

/** The HH:mm wall-clock time to persist for a routine in its own zone. */
export function timeInZone(instant: Date, timeZone: string): string {
  return toWallClock(instant, safeZone(timeZone, false)).toISOString().slice(11, 16)
}

/**
 * Whether a routine's rule lands on a date. A routine has times of day rather than a
 * start date, so its rule counts from the day it was created.
 */
export function routineOccursOn(rule: string, createdAt: string, date: string): boolean {
  if (!isValidRecurrenceRule(rule)) return false
  const anchor = new Date(`${createdAt.slice(0, 10)}T00:00:00.000Z`)
  const day = new Date(`${date}T00:00:00.000Z`)
  if (day < anchor) return false
  const series = new RRule({ ...RRule.parseString(ruleText(rule)), dtstart: anchor })
  return series.between(day, day, true).length > 0
}

/** A copy of `rule` ending just before `before`. Drops any COUNT, which UNTIL replaces. */
export function ruleEndingBefore(rule: string, before: Date): string {
  const until = new Date(before.getTime() - 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const kept = ruleText(rule)
    .split(';')
    .filter((part) => part && !/^(UNTIL|COUNT)=/i.test(part))
  return [...kept, `UNTIL=${until}`].join(';')
}

/** A copy of `rule` for a series continuing from a split, without its old end. */
export function ruleWithoutCount(rule: string): string {
  return ruleText(rule)
    .split(';')
    .filter((part) => part && !/^COUNT=/i.test(part))
    .join(';')
}

/** The `recurrence` array Google expects for a series. */
export function googleRecurrence(
  rule: string,
  exceptions?: string[] | null,
): string[] {
  const line = /^RRULE:/i.test(rule) ? rule : `RRULE:${rule}`
  return [line, ...exceptionLines(exceptions)]
}

/** `EXDATE` lines Google understands, for a master event's recurrence array. */
export function exceptionLines(exceptions: string[] | null | undefined): string[] {
  return (exceptions ?? []).map((iso) => {
    const stamp = new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    return `EXDATE:${stamp}`
  })
}

/** Parses `EXDATE` lines from a Google recurrence array into ISO instants. */
export function parseExceptionLines(lines: string[] | null | undefined): string[] {
  const out: string[] = []
  for (const line of lines ?? []) {
    if (!/^EXDATE/i.test(line)) continue
    const values = line.slice(line.indexOf(':') + 1)
    for (const value of values.split(',')) {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value.trim())
      if (!m) continue
      out.push(
        new Date(
          Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)),
        ).toISOString(),
      )
    }
  }
  return out
}

// A grid item for one occurrence of a series carries the occurrence in its id.
const OCCURRENCE_SEPARATOR = '::'

export function occurrenceItemId(eventId: string, occurrenceStart: Date): string {
  return `${eventId}${OCCURRENCE_SEPARATOR}${occurrenceStart.getTime()}`
}

export function parseEventItemId(itemId: string): { eventId: string; occurrenceStart: string | null } {
  const at = itemId.indexOf(OCCURRENCE_SEPARATOR)
  if (at === -1) return { eventId: itemId, occurrenceStart: null }
  const ms = Number(itemId.slice(at + OCCURRENCE_SEPARATOR.length))
  return {
    eventId: itemId.slice(0, at),
    occurrenceStart: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
  }
}

/** The filter for rows that can have an occurrence in a window, for PostgREST `.or()`. */
export function eventsInWindowFilter(startIso: string, endIso: string): string {
  return (
    `and(start_time.lte.${endIso},end_time.gte.${startIso}),` +
    `and(recurrence_rule.not.is.null,start_time.lte.${endIso})`
  )
}
