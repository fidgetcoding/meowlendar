import { describe, it, expect } from 'vitest'
import { createEventSchema, updateEventSchema, rsvpSchema } from '../event'

/* ------------------------------------------------------------------ */
/*  helpers                                                           */
/* ------------------------------------------------------------------ */

function validEvent() {
  return {
    calendar_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    title: 'Team standup',
    start_time: '2026-06-15T09:00:00Z',
    end_time: '2026-06-15T09:30:00Z',
  }
}

/* ------------------------------------------------------------------ */
/*  createEventSchema                                                 */
/* ------------------------------------------------------------------ */

describe('createEventSchema', () => {
  /* --- happy path --- */

  it('accepts minimal valid input', () => {
    const result = createEventSchema.safeParse(validEvent())
    expect(result.success).toBe(true)
  })

  it('accepts full valid input with every optional field', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      notes: 'Discuss roadmap',
      timezone: 'Europe/London',
      is_all_day: true,
      location: 'Room 4B',
      color_override: '#ff00aa',
      visibility: 'free',
      privacy: 'private',
      conferencing: true,
      recurrence_rule: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      attendees: [
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com' },
      ],
      reminders: [{ minutes_before: 15 }, { minutes_before: 60 }],
    })
    expect(result.success).toBe(true)
  })

  it('applies defaults for omitted optional fields', () => {
    const result = createEventSchema.parse(validEvent())
    expect(result.timezone).toBe('America/New_York')
    expect(result.is_all_day).toBe(false)
    expect(result.visibility).toBe('busy')
    expect(result.privacy).toBe('public')
    expect(result.conferencing).toBe(false)
    expect(result.attendees).toEqual([])
    expect(result.reminders).toEqual([])
  })

  /* --- required fields --- */

  it('rejects missing calendar_id', () => {
    const { calendar_id: _, ...rest } = validEvent()
    const result = createEventSchema.safeParse(rest)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['calendar_id'])
  })

  it('rejects missing title', () => {
    const { title: _, ...rest } = validEvent()
    const result = createEventSchema.safeParse(rest)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })

  it('rejects missing start_time', () => {
    const { start_time: _, ...rest } = validEvent()
    const result = createEventSchema.safeParse(rest)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['start_time'])
  })

  it('rejects missing end_time', () => {
    const { end_time: _, ...rest } = validEvent()
    const result = createEventSchema.safeParse(rest)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['end_time'])
  })

  /* --- type / format validation --- */

  it('rejects non-uuid calendar_id', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), calendar_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['calendar_id'])
  })

  it('rejects empty title', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), title: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })

  it('rejects title exceeding 500 characters', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), title: 'a'.repeat(501) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })

  it('rejects non-datetime start_time', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), start_time: '2026-06-15' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['start_time'])
  })

  it('rejects non-datetime end_time', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), end_time: 'not-a-date' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['end_time'])
  })

  /* --- notes --- */

  it('accepts null notes', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), notes: null })
    expect(result.success).toBe(true)
  })

  it('rejects notes exceeding 10000 characters', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), notes: 'x'.repeat(10001) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['notes'])
  })

  /* --- location --- */

  it('accepts null location', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), location: null })
    expect(result.success).toBe(true)
  })

  it('rejects location exceeding 500 characters', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), location: 'x'.repeat(501) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['location'])
  })

  /* --- color_override --- */

  it('accepts valid hex color', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), color_override: '#aaBBcc' })
    expect(result.success).toBe(true)
  })

  it('accepts null color_override', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), color_override: null })
    expect(result.success).toBe(true)
  })

  it('rejects invalid hex color (missing hash)', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), color_override: 'ff00aa' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['color_override'])
  })

  it('rejects 3-digit hex shorthand', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), color_override: '#f0a' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['color_override'])
  })

  it('rejects 8-digit hex (alpha channel)', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), color_override: '#ff00aaff' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['color_override'])
  })

  /* --- enums --- */

  it('rejects invalid visibility value', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), visibility: 'tentative' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['visibility'])
  })

  it('rejects invalid privacy value', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), privacy: 'unlisted' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['privacy'])
  })

  /* --- attendees --- */

  it('rejects attendee with invalid email', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      attendees: [{ email: 'not-an-email' }],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['attendees', 0, 'email'])
  })

  it('enforces attendees max of 200', () => {
    const attendees = Array.from({ length: 201 }, (_, i) => ({
      email: `user${i}@example.com`,
    }))
    const result = createEventSchema.safeParse({ ...validEvent(), attendees })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['attendees'])
  })

  it('accepts exactly 200 attendees', () => {
    const attendees = Array.from({ length: 200 }, (_, i) => ({
      email: `user${i}@example.com`,
    }))
    const result = createEventSchema.safeParse({ ...validEvent(), attendees })
    expect(result.success).toBe(true)
  })

  /* --- reminders --- */

  it('rejects reminder with non-positive minutes', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      reminders: [{ minutes_before: 0 }],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['reminders', 0, 'minutes_before'])
  })

  it('rejects reminder with negative minutes', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      reminders: [{ minutes_before: -5 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects reminder with fractional minutes', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      reminders: [{ minutes_before: 10.5 }],
    })
    expect(result.success).toBe(false)
  })

  it('enforces reminders max of 20', () => {
    const reminders = Array.from({ length: 21 }, () => ({ minutes_before: 15 }))
    const result = createEventSchema.safeParse({ ...validEvent(), reminders })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['reminders'])
  })

  /* --- recurrence_rule --- */

  it('accepts null recurrence_rule', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), recurrence_rule: null })
    expect(result.success).toBe(true)
  })

  it('accepts string recurrence_rule', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      recurrence_rule: 'RRULE:FREQ=DAILY',
    })
    expect(result.success).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  updateEventSchema                                                 */
/* ------------------------------------------------------------------ */

describe('updateEventSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateEventSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts partial update with title only', () => {
    const result = updateEventSchema.safeParse({ title: 'Renamed standup' })
    expect(result.success).toBe(true)
  })

  it('accepts scope field', () => {
    const result = updateEventSchema.safeParse({ scope: 'future' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid scope value', () => {
    const result = updateEventSchema.safeParse({ scope: 'none' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['scope'])
  })

  it('accepts all valid scope values', () => {
    for (const scope of ['single', 'future', 'all', 'custom']) {
      const result = updateEventSchema.safeParse({ scope })
      expect(result.success).toBe(true)
    }
  })

  it('accepts scope_dates as string array', () => {
    const result = updateEventSchema.safeParse({
      scope: 'custom',
      scope_dates: ['2026-06-15T10:00:00.000Z', '2026-06-22T10:00:00.000Z'],
    })
    expect(result.success).toBe(true)
  })

  it('enforces scope_dates max of 366', () => {
    const scope_dates = Array.from({ length: 367 }, () => '2026-06-15T10:00:00.000Z')
    const result = updateEventSchema.safeParse({ scope: 'custom', scope_dates })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['scope_dates'])
  })

  it('still validates field constraints when present', () => {
    const result = updateEventSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })
})

/* ------------------------------------------------------------------ */
/*  rsvpSchema                                                        */
/* ------------------------------------------------------------------ */

describe('rsvpSchema', () => {
  it('accepts accepted', () => {
    expect(rsvpSchema.safeParse({ response: 'accepted' }).success).toBe(true)
  })

  it('accepts declined', () => {
    expect(rsvpSchema.safeParse({ response: 'declined' }).success).toBe(true)
  })

  it('accepts tentative', () => {
    expect(rsvpSchema.safeParse({ response: 'tentative' }).success).toBe(true)
  })

  it('rejects invalid response', () => {
    const result = rsvpSchema.safeParse({ response: 'maybe' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['response'])
  })

  it('rejects missing response', () => {
    const result = rsvpSchema.safeParse({})
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['response'])
  })
})
