import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEventSchema, createRoutineSchema, createTaskSchema } from '@poolendar/validators'
import { unloadCommits } from '../unload-commit'
import type { CreateEventInput } from '@/lib/hooks/use-events'
import type { CreateTaskInput } from '@/lib/hooks/use-tasks'
import type { CreateRoutineInput } from '@/lib/hooks/use-routines'

// A create resent on unload goes to the same API route as any other create, so its body has to
// pass the same validation. One without a calendar_id used to come back 422, and the event was
// lost on the reload that triggered the resend.

const CAL = '6d7f0b1e-2c3a-4b5d-8e9f-0a1b2c3d4e5f'
const TAG = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'

function event(overrides: Partial<CreateEventInput> = {}): CreateEventInput & { id: string } {
  // The shape EditFormHost and the grid's quick create build.
  return {
    id: crypto.randomUUID(),
    user_id: null,
    calendar_id: CAL,
    google_event_id: null,
    title: 'Local event',
    notes: null,
    start_time: new Date(2026, 10, 5, 14, 0).toISOString(),
    end_time: new Date(2026, 10, 5, 14, 30).toISOString(),
    timezone: 'America/New_York',
    is_all_day: false,
    location: null,
    color_override: null,
    visibility: 'busy',
    privacy: 'public',
    conferencing_url: null,
    recurrence_rule: null,
    recurrence_id: null,
    attendees: [],
    reminders: [],
    status: 'confirmed',
    sync_status: 'pending_push',
    etag: null,
    ...overrides,
  }
}

describe('keepalive create bodies', () => {
  let fetchMock: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>
  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }))
  })
  afterEach(() => fetchMock.mockRestore())

  const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>

  it.each([
    ['a plain timed event', event()],
    ['an all-day Free event', event({ is_all_day: true, visibility: 'free', start_time: '2026-11-05T00:00:00.000Z', end_time: '2026-11-06T00:00:00.000Z' })],
    ['a recurring event with guests, reminders and a colour', event({
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=TH', notes: 'Bring the deck', location: 'Studio', color_override: '#5a68d4',
      attendees: [{ email: 'kai@example.com', name: 'Kai' }, { email: 'ana@example.com' }], reminders: [{ minutes_before: 10 }],
    })],
  ])('sends %s as a body the events route accepts', (_name, input) => {
    unloadCommits.createEvent(input)()
    const body = sentBody()
    const parsed = createEventSchema.safeParse(body)
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(body).toMatchObject({ id: input.id, calendar_id: CAL, title: input.title, start_time: input.start_time, end_time: input.end_time })
  })

  it('reads the calendar when the page goes, so one resolved after the create began is sent', () => {
    const input = event({ calendar_id: null })
    const commit = unloadCommits.createEvent(input)
    input.calendar_id = CAL
    commit()
    expect(createEventSchema.safeParse(sentBody()).success).toBe(true)
  })

  it('sends nothing rather than a row the API would reject', () => {
    unloadCommits.createEvent(event({ calendar_id: null }))()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a task as a body the tasks route accepts', () => {
    const task = {
      id: crypto.randomUUID(), title: 'Typed then reloaded', notes: 'Notes', calendar_id: null, importance: 'high',
      time_estimate_minutes: 30, earliest_start: '2026-11-05', due_date: '2026-11-07', due_date_recurrence: null,
      scheduled_start: '2026-11-05T15:00:00.000Z', scheduled_end: '2026-11-05T15:30:00.000Z', location: null,
      visibility: 'busy', privacy: 'private', flexibility: 'flexible', status: 'backlog', board: 'current',
      completed_at: null, reminders: [{ minutes_before: 5 }], tag_ids: [TAG],
    } as unknown as CreateTaskInput & { id: string }
    unloadCommits.createTask(task)()
    const parsed = createTaskSchema.safeParse(sentBody())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(sentBody()).toMatchObject({ id: task.id, title: task.title, due_date: '2026-11-07', tag_ids: [TAG] })
  })

  it('sends a routine as a body the routines route accepts, times as HH:mm', () => {
    const routine = {
      id: crypto.randomUUID(), title: 'Stretch', notes: null, calendar_id: CAL, start_time: '08:00:00', end_time: '08:15:00',
      timezone: 'America/New_York', recurrence_rule: 'FREQ=DAILY', location: null, visibility: 'busy', privacy: 'private', reminders: [],
    } as unknown as CreateRoutineInput & { id: string }
    unloadCommits.createRoutine(routine)()
    const parsed = createRoutineSchema.safeParse(sentBody())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(sentBody()).toMatchObject({ start_time: '08:00', end_time: '08:15' })
  })
})
