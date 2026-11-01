// Pure shared availability engine for booking links (spec #56). Both the public
// availability endpoint and the book endpoint route their conflict math through
// here so the two can never disagree. No I/O: callers fetch the busy data (all
// of the host's bookings pool-wide, the host's calendar events, and — when a
// Google account is connected — Google freeBusy) and hand it in. That keeps the
// #56 pool proof and the buffer/min-notice math unit-testable, and it means a
// failed DB read fails CLOSED in the route rather than here.

export interface AvailabilityWindow {
  day: string
  start: string
  end: string
}

export interface AvailabilitySlot {
  start: string
  end: string
}

/** A booking anywhere in the host's pool. `buffer_minutes` is the buffer of the
 *  link it was made under — reserved on both sides of the booking. */
export interface BusyBooking {
  start_time: string
  end_time: string
  buffer_minutes: number
}

export interface BusyEvent {
  start_time: string
  end_time: string
}

/** Google freeBusy period (RFC3339 start/end). */
export interface BusyPeriod {
  start: string
  end: string
}

/** Epoch-ms half-open interval [start, end) that a candidate slot may not overlap. */
export interface BlockedInterval {
  start: number
  end: number
}

export function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

export function getDayOfWeek(dateStr: string): string {
  const parts = dateStr.split('-').map(Number)
  const date = new Date(parts[0]!, (parts[1] ?? 1) - 1, parts[2] ?? 1)
  return date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
}

/** Interpret `dateStr`+`timeStr` as a wall-clock time in `timezone`, return the UTC instant. */
export function timeInTimezoneToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const isoStr = `${dateStr}T${timeStr}:00`
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date(isoStr + 'Z'))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  const utcDate = new Date(isoStr + 'Z')
  const localInTz = new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`
  )
  const offset = localInTz.getTime() - utcDate.getTime()
  return new Date(utcDate.getTime() - offset)
}

export function addDaysStr(dateStr: string, days: number): string {
  const parts = dateStr.split('-').map(Number)
  // Date.UTC, not local time: local midnight east of UTC serializes to the
  // previous day, so the date would never advance and slot loops would spin.
  const d = new Date(Date.UTC(parts[0]!, (parts[1] ?? 1) - 1, (parts[2] ?? 1) + days))
  return d.toISOString().split('T')[0]!
}

/**
 * Fold every busy source into a single list of blocked intervals, expanding each
 * by the relevant buffers. A candidate slot for the *current* link carries the
 * current link's buffer (`currentBufferMinutes`) on both sides, and each existing
 * booking carries its own link's buffer — so two reserved regions never touch.
 * We fold both expansions into the blocked interval so the slot check stays a
 * bare-slot overlap:
 *   booking → [start − (bookingBuffer + currentBuffer), end + (bookingBuffer + currentBuffer)]
 *   event / google-busy → [start − currentBuffer, end + currentBuffer]
 */
export function computeBlockedIntervals(opts: {
  bookings: BusyBooking[]
  events: BusyEvent[]
  googleBusy?: BusyPeriod[]
  currentBufferMinutes: number
}): BlockedInterval[] {
  const curBufferMs = opts.currentBufferMinutes * 60_000
  const intervals: BlockedInterval[] = []

  for (const b of opts.bookings) {
    const pad = curBufferMs + (b.buffer_minutes ?? 0) * 60_000
    intervals.push({
      start: new Date(b.start_time).getTime() - pad,
      end: new Date(b.end_time).getTime() + pad,
    })
  }
  for (const e of opts.events) {
    intervals.push({
      start: new Date(e.start_time).getTime() - curBufferMs,
      end: new Date(e.end_time).getTime() + curBufferMs,
    })
  }
  for (const g of opts.googleBusy ?? []) {
    intervals.push({
      start: new Date(g.start).getTime() - curBufferMs,
      end: new Date(g.end).getTime() + curBufferMs,
    })
  }
  return intervals
}

/** True when [slotStartMs, slotEndMs) overlaps any blocked interval. */
export function hasConflict(
  slotStartMs: number,
  slotEndMs: number,
  blocked: BlockedInterval[]
): boolean {
  return blocked.some((b) => slotStartMs < b.end && slotEndMs > b.start)
}

/**
 * Generate every free slot in [startDate, endDate] (inclusive, YYYY-MM-DD) for a
 * link, filtering out anything before the minimum-notice horizon or overlapping
 * a blocked interval. Slot cadence is the link duration (matches prior behavior).
 */
export function computeAvailableSlots(opts: {
  availability: AvailabilityWindow[]
  startDate: string
  endDate: string
  timezone: string
  durationMinutes: number
  now: Date
  minimumNoticeHours: number
  blocked: BlockedInterval[]
}): AvailabilitySlot[] {
  const {
    availability,
    startDate,
    endDate,
    timezone,
    durationMinutes,
    now,
    minimumNoticeHours,
    blocked,
  } = opts

  const minimumStartTime = new Date(now.getTime() + minimumNoticeHours * 60 * 60 * 1000)
  const slots: AvailabilitySlot[] = []
  let currentDate = startDate

  while (currentDate <= endDate) {
    const dayOfWeek = getDayOfWeek(currentDate)
    const windows = availability.filter((w) => w.day === dayOfWeek)

    for (const window of windows) {
      const windowStart = timeToMinutes(window.start)
      const windowEnd = timeToMinutes(window.end)
      let cursor = windowStart

      while (cursor + durationMinutes <= windowEnd) {
        const slotStart = timeInTimezoneToUtc(currentDate, minutesToTime(cursor), timezone)
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000)

        if (slotStart >= minimumStartTime) {
          if (!hasConflict(slotStart.getTime(), slotEnd.getTime(), blocked)) {
            slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() })
          }
        }
        cursor += durationMinutes
      }
    }
    currentDate = addDaysStr(currentDate, 1)
  }

  return slots
}
