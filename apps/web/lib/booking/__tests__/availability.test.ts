import { describe, it, expect } from 'vitest'
import {
  addDaysStr,
  timeInTimezoneToUtc,
  computeBlockedIntervals,
  computeAvailableSlots,
  hasConflict,
  type AvailabilityWindow,
} from '../availability'

// A Monday well in the future so minimum-notice never trims the window.
const MONDAY = '2026-08-03' // 2026-08-03 is a Monday
const NY = 'America/New_York'
// Reference "now" far before the window so minimumNoticeHours=0 keeps all slots.
const NOW = new Date('2026-08-01T00:00:00Z')

const nineToFive: AvailabilityWindow[] = [{ day: 'monday', start: '13:00', end: '17:00' }]

/** UTC ISO for a wall-clock ET time on MONDAY (ET is UTC-4 in August). */
function et(hhmm: string): string {
  return `2026-08-03T${hhmm}:00-04:00`
}

describe('addDaysStr', () => {
  it.each(['Asia/Dubai', 'UTC', 'America/New_York'])('advances the date with TZ=%s', (tz) => {
    const original = process.env.TZ
    process.env.TZ = tz
    try {
      expect(addDaysStr('2026-08-03', 1)).toBe('2026-08-04')
      expect(addDaysStr('2026-12-31', 1)).toBe('2027-01-01')
    } finally {
      process.env.TZ = original
    }
  })
})

describe('computeBlockedIntervals', () => {
  it('expands a booking by its own buffer plus the current link buffer', () => {
    const blocked = computeBlockedIntervals({
      bookings: [{ start_time: et('14:00'), end_time: et('14:30'), buffer_minutes: 15 }],
      events: [],
      currentBufferMinutes: 10,
    })
    const bookingStart = new Date(et('14:00')).getTime()
    const bookingEnd = new Date(et('14:30')).getTime()
    // 15 (booking) + 10 (current) = 25 min padding each side.
    expect(blocked[0]!.start).toBe(bookingStart - 25 * 60_000)
    expect(blocked[0]!.end).toBe(bookingEnd + 25 * 60_000)
  })

  it('expands events and google-busy by only the current link buffer', () => {
    const blocked = computeBlockedIntervals({
      bookings: [],
      events: [{ start_time: et('09:00'), end_time: et('10:00') }],
      googleBusy: [{ start: et('11:00'), end: et('11:30') }],
      currentBufferMinutes: 5,
    })
    expect(blocked[0]!.start).toBe(new Date(et('09:00')).getTime() - 5 * 60_000)
    expect(blocked[1]!.end).toBe(new Date(et('11:30')).getTime() + 5 * 60_000)
  })
})

describe('hasConflict', () => {
  it('treats touching intervals as non-conflicting (half-open)', () => {
    const blocked = [{ start: 100, end: 200 }]
    expect(hasConflict(200, 300, blocked)).toBe(false) // starts where blocked ends
    expect(hasConflict(0, 100, blocked)).toBe(false) // ends where blocked starts
    expect(hasConflict(150, 250, blocked)).toBe(true)
  })
})

describe('computeAvailableSlots — basic generation', () => {
  it('generates duration-cadence slots across the window', () => {
    const slots = computeAvailableSlots({
      availability: nineToFive,
      startDate: MONDAY,
      endDate: MONDAY,
      timezone: NY,
      durationMinutes: 60,
      now: NOW,
      minimumNoticeHours: 0,
      blocked: [],
    })
    // 13:00,14:00,15:00,16:00 ET
    expect(slots.map((s) => s.start)).toEqual([
      new Date(et('13:00')).toISOString(),
      new Date(et('14:00')).toISOString(),
      new Date(et('15:00')).toISOString(),
      new Date(et('16:00')).toISOString(),
    ])
  })

  it('drops slots inside the minimum-notice horizon', () => {
    // now = MONDAY 13:30 ET, 2h notice → first bookable start is 15:30, so only 16:00 survives.
    const slots = computeAvailableSlots({
      availability: nineToFive,
      startDate: MONDAY,
      endDate: MONDAY,
      timezone: NY,
      durationMinutes: 60,
      now: new Date(et('13:30')),
      minimumNoticeHours: 2,
      blocked: [],
    })
    expect(slots.map((s) => s.start)).toEqual([new Date(et('16:00')).toISOString()])
  })
})

describe('#56 shared availability pool', () => {
  it('blocks a 60min slot overlapping a 30min booking made under a DIFFERENT link', () => {
    // Someone booked the 30min link at 2:00-2:30 PM. Its buffer is 0.
    const blocked = computeBlockedIntervals({
      bookings: [{ start_time: et('14:00'), end_time: et('14:30'), buffer_minutes: 0 }],
      events: [],
      currentBufferMinutes: 0,
    })

    const slots = computeAvailableSlots({
      availability: nineToFive, // 60min link covers the same 1-5pm Monday window
      startDate: MONDAY,
      endDate: MONDAY,
      timezone: NY,
      durationMinutes: 60,
      now: NOW,
      minimumNoticeHours: 0,
      blocked,
    })

    const starts = slots.map((s) => s.start)
    // 14:00-15:00 overlaps the 2:00-2:30 booking → must be gone.
    expect(starts).not.toContain(new Date(et('14:00')).toISOString())
    // Non-overlapping slots survive.
    expect(starts).toContain(new Date(et('13:00')).toISOString())
    expect(starts).toContain(new Date(et('15:00')).toISOString())
    expect(starts).toContain(new Date(et('16:00')).toISOString())
  })

  it('a booking buffer widens the blocked window across the pool', () => {
    // 30min booking at 2:00-2:30 with a 15min buffer → reserves 1:45-2:45.
    const blocked = computeBlockedIntervals({
      bookings: [{ start_time: et('14:00'), end_time: et('14:30'), buffer_minutes: 15 }],
      events: [],
      currentBufferMinutes: 0,
    })
    const slots = computeAvailableSlots({
      availability: nineToFive,
      startDate: MONDAY,
      endDate: MONDAY,
      timezone: NY,
      durationMinutes: 60,
      now: NOW,
      minimumNoticeHours: 0,
      blocked,
    })
    const starts = slots.map((s) => s.start)
    // 13:00-14:00 now overlaps the 1:45 buffer edge → blocked too.
    expect(starts).not.toContain(new Date(et('13:00')).toISOString())
    expect(starts).not.toContain(new Date(et('14:00')).toISOString())
    expect(starts).toContain(new Date(et('15:00')).toISOString())
  })
})


describe('booking wall clock conversion', () => {
  it('uses the offset at the requested time on DST transition days', () => {
    expect(timeInTimezoneToUtc('2026-03-08', '04:00', NY).toISOString())
      .toBe('2026-03-08T08:00:00.000Z')
    expect(timeInTimezoneToUtc('2026-11-01', '04:00', NY).toISOString())
      .toBe('2026-11-01T09:00:00.000Z')
  })
})

it('rejects an invalid booking timezone instead of silently scheduling in UTC', () => {
  expect(() => timeInTimezoneToUtc('2030-01-08', '09:00', 'Invalid/Timezone')).toThrow(RangeError)
})
