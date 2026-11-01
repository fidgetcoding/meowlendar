import { describe, it, expect } from 'vitest'
import {
  exceptionLines,
  expandOccurrences,
  isValidRecurrenceRule,
  occurrenceItemId,
  parseEventItemId,
  parseExceptionLines,
  ruleEndingBefore,
} from '../recurrence'

const base = {
  start_time: '2026-03-02T14:00:00.000Z', // Monday 9am in New York (EST)
  end_time: '2026-03-02T15:00:00.000Z',
  timezone: 'America/New_York',
}

describe('expandOccurrences', () => {
  it('returns a plain event once, only when it overlaps', () => {
    const ev = { ...base, recurrence_rule: null }
    expect(expandOccurrences(ev, new Date('2026-03-02T00:00:00Z'), new Date('2026-03-03T00:00:00Z'))).toHaveLength(1)
    expect(expandOccurrences(ev, new Date('2026-03-05T00:00:00Z'), new Date('2026-03-06T00:00:00Z'))).toHaveLength(0)
  })

  it('finds occurrences long after the first one', () => {
    const out = expandOccurrences(
      { ...base, recurrence_rule: 'RRULE:FREQ=WEEKLY;BYDAY=MO' },
      new Date('2026-10-05T00:00:00Z'),
      new Date('2026-10-12T00:00:00Z'),
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]!.start.getUTCDay()).toBe(1)
  })

  it('keeps the wall clock across a daylight saving change', () => {
    // US clocks change on 2026-03-08. 9am EST is 14:00Z, 9am EDT is 13:00Z.
    const out = expandOccurrences(
      { ...base, recurrence_rule: 'FREQ=DAILY' },
      new Date('2026-03-07T00:00:00Z'),
      new Date('2026-03-09T23:00:00Z'),
    )
    const hours = out.map((o) => o.start.getUTCHours())
    expect(hours).toEqual([14, 13, 13])
  })

  it('holds the same local time in a zone east of UTC', () => {
    const out = expandOccurrences(
      { start_time: '2026-03-02T05:00:00.000Z', end_time: '2026-03-02T06:00:00.000Z', timezone: 'Asia/Dubai', recurrence_rule: 'FREQ=DAILY;COUNT=3' },
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-10T00:00:00Z'),
    )
    expect(out.map((o) => o.start.toISOString())).toEqual([
      '2026-03-02T05:00:00.000Z',
      '2026-03-03T05:00:00.000Z',
      '2026-03-04T05:00:00.000Z',
    ])
  })

  it('skips exceptions and keeps duration', () => {
    const out = expandOccurrences(
      { ...base, recurrence_rule: 'FREQ=DAILY;COUNT=3', recurrence_exceptions: ['2026-03-03T14:00:00.000Z'] },
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-10T00:00:00Z'),
    )
    expect(out).toHaveLength(2)
    expect(out[0]!.end.getTime() - out[0]!.start.getTime()).toBe(3_600_000)
  })

  it('respects UNTIL', () => {
    const rule = ruleEndingBefore('FREQ=DAILY;COUNT=30', new Date('2026-03-04T14:00:00.000Z'))
    expect(rule).not.toContain('COUNT')
    const out = expandOccurrences({ ...base, recurrence_rule: rule }, new Date('2026-03-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'))
    expect(out).toHaveLength(2)
  })

  it('falls back to a single event for a rule it cannot read', () => {
    const out = expandOccurrences({ ...base, recurrence_rule: 'nonsense' }, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-10T00:00:00Z'))
    expect(out).toHaveLength(1)
  })

  it('handles an all-day series in UTC', () => {
    const out = expandOccurrences(
      { start_time: '2026-03-02T00:00:00.000Z', end_time: '2026-03-03T00:00:00.000Z', is_all_day: true, timezone: 'America/New_York', recurrence_rule: 'FREQ=DAILY;COUNT=2' },
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-10T00:00:00Z'),
    )
    expect(out.map((o) => o.start.toISOString().slice(0, 10))).toEqual(['2026-03-02', '2026-03-03'])
  })
})

describe('helpers', () => {
  it('validates rules', () => {
    expect(isValidRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE')).toBe(true)
    expect(isValidRecurrenceRule('RRULE:FREQ=DAILY')).toBe(true)
    expect(isValidRecurrenceRule('hello')).toBe(false)
    expect(isValidRecurrenceRule('FREQ=DAILY'.padEnd(2000, ';'))).toBe(false)
  })

  it('round-trips occurrence item ids', () => {
    const when = new Date('2026-03-03T14:00:00.000Z')
    expect(parseEventItemId(occurrenceItemId('abc', when))).toEqual({ eventId: 'abc', occurrenceStart: when.toISOString() })
    expect(parseEventItemId('abc')).toEqual({ eventId: 'abc', occurrenceStart: null })
  })

  it('round-trips exception lines for Google', () => {
    const iso = ['2026-03-03T14:00:00.000Z']
    expect(parseExceptionLines(exceptionLines(iso))).toEqual(iso)
    expect(parseExceptionLines(['RRULE:FREQ=DAILY', 'EXDATE;TZID=UTC:20260303T140000,20260304T140000'])).toHaveLength(2)
  })
})
