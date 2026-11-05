import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { createElement, type ReactNode } from 'react'
import { mockSupabaseClient, mockSupabaseResults, resetSupabaseMocks } from '@/lib/hooks/__tests__/mock-supabase'
import { calendarKeys } from '@/lib/hooks/use-calendars'
import { createEventSchema } from '@poolendar/validators'
import { UndoProvider } from '../undo-context'
import { useUndoable } from '@/lib/hooks/use-undoable'
import type { CalendarEvent, Routine, Task } from '@poolendar/types'

vi.stubGlobal('React', React)

// Reloading or closing the tab inside a grace window used to lose the change: the pending write
// went through the Supabase client, whose requests the browser aborts on unload (and the event
// delete began with a read). Now pagehide sends each operation's final write with keepalive.

const task = { id: 'task-1', status: 'backlog', scheduled_start: null } as unknown as Task
const event = { id: 'evt-1' } as unknown as CalendarEvent
const routine = { id: 'rtn-1' } as unknown as Routine

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, createElement(UndoProvider, { gracePeriodMs: 30_000 }, children))
  return renderHook(() => useUndoable(), { wrapper }).result
}

describe('leaving the page inside a grace window', () => {
  let fetchMock: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

  beforeEach(() => {
    vi.useFakeTimers()
    resetSupabaseMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
  })
  afterEach(() => {
    vi.useRealTimers()
    fetchMock.mockRestore()
  })

  it('sends a keepalive request with the final write for every pending operation, and no reads', () => {
    const actions = setup()
    act(() => {
      actions.current.deleteEvent(event)
      actions.current.deleteTask(task)
      actions.current.completeTask({ ...task, id: 'task-2' })
      actions.current.moveTask({ id: 'task-3', status: 'in_progress', board: 'current', position: 2 }, { ...task, id: 'task-3' })
      actions.current.deleteRoutine(routine)
      actions.current.completeRoutineInstance('rtn-2', '2026-11-05')
    })
    expect(fetchMock).not.toHaveBeenCalled()
    const supabaseCallsBefore = mockSupabaseClient.from.mock.calls.length

    act(() => { window.dispatchEvent(new Event('pagehide')) })

    const sent = fetchMock.mock.calls.map(([path, init]) => ({
      path,
      method: (init as RequestInit).method,
      body: (init as RequestInit).body ? JSON.parse((init as RequestInit).body as string) : undefined,
    }))
    expect(sent).toEqual(expect.arrayContaining([
      { path: '/api/events/evt-1', method: 'DELETE', body: undefined },
      { path: '/api/tasks/task-1', method: 'DELETE', body: undefined },
      { path: '/api/tasks/task-2/complete', method: 'POST', body: undefined },
      { path: '/api/tasks/task-3/move', method: 'POST', body: { status: 'in_progress', board: 'current', position: 2 } },
      { path: '/api/tasks/task-3', method: 'PATCH', body: { scheduled_start: expect.any(String) } },
      { path: '/api/routines/rtn-1', method: 'DELETE', body: undefined },
      { path: '/api/routines/rtn-2/instances/2026-11-05', method: 'PATCH', body: { status: 'completed' } },
    ]))
    expect(sent).toHaveLength(7)
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ keepalive: true, credentials: 'same-origin' })
    }
    // Nothing went through the Supabase client, so there is no read to wait on.
    expect(mockSupabaseClient.from.mock.calls.length).toBe(supabaseCallsBefore)

    // And nothing is sent again when the grace timers would have fired.
    act(() => vi.advanceTimersByTime(30_000))
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })
})

// A create typed and then reloaded straight away used to be lost: its insert was still waiting
// on a round trip when the page went. Now pagehide resends any create still in flight, under the
// id the page chose, so the API makes it once.
describe('leaving the page right after creating something', () => {
  let fetchMock: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>
  beforeEach(() => {
    resetSupabaseMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }))
  })
  afterEach(() => fetchMock.mockRestore())

  it('resends each create still in flight as a keepalive POST with its id', () => {
    const actions = setup()
    act(() => {
      actions.current.createEvent({
        calendar_id: 'cal-1', title: 'Local event', notes: null, start_time: '2026-11-05T19:00:00.000Z', end_time: '2026-11-05T19:30:00.000Z',
        timezone: 'America/New_York', is_all_day: false, location: null, color_override: null, visibility: 'busy', privacy: 'public',
        conferencing_url: null, recurrence_rule: null, recurrence_id: null, attendees: [], reminders: [], status: 'confirmed',
        sync_status: 'synced', etag: null, google_event_id: null, user_id: 'u1',
      })
      actions.current.createTask({ title: 'Typed then reloaded', status: 'backlog', board: 'current', importance: 'normal' } as never)
      actions.current.createRoutine({ title: 'Stretch', start_time: '08:00', end_time: '08:15', timezone: 'UTC', recurrence_rule: 'FREQ=DAILY' } as never)
    })

    act(() => { window.dispatchEvent(new Event('pagehide')) })

    const posts = fetchMock.mock.calls.map(([path, init]) => ({ path: String(path), init: init as RequestInit, body: JSON.parse(String((init as RequestInit).body)) }))
    expect(posts.map((p) => p.path).sort()).toEqual(['/api/events', '/api/routines', '/api/tasks'])
    for (const p of posts) {
      expect(p.init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin' })
      expect(p.body.id).toMatch(/^[0-9a-f-]{36}$/)
    }
    expect(new Set(posts.map((p) => p.body.id)).size).toBe(3)
    expect(posts.find((p) => p.path === '/api/events')!.body).toMatchObject({ calendar_id: 'cal-1', title: 'Local event', start_time: '2026-11-05T19:00:00.000Z' })
    expect(posts.find((p) => p.path === '/api/tasks')!.body).toMatchObject({ title: 'Typed then reloaded', status: 'backlog' })
    expect(posts.find((p) => p.path === '/api/routines')!.body).toMatchObject({ title: 'Stretch', start_time: '08:00', recurrence_rule: 'FREQ=DAILY' })
  })
})

// The grid's create used to leave the calendar for the insert to look up, so a resend on unload
// had none and the API refused it.
describe('the calendar of a create that left it unchosen', () => {
  let fetchMock: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>
  beforeEach(() => {
    resetSupabaseMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }))
  })
  afterEach(() => fetchMock.mockRestore())

  const CAL = '6d7f0b1e-2c3a-4b5d-8e9f-0a1b2c3d4e5f'
  const unchosen = {
    calendar_id: null, title: 'Local event', notes: null, start_time: '2026-11-05T19:00:00.000Z', end_time: '2026-11-05T19:30:00.000Z',
    timezone: 'America/New_York', is_all_day: false, location: null, color_override: null, visibility: 'busy', privacy: 'public',
    conferencing_url: null, recurrence_rule: null, recurrence_id: null, attendees: [], reminders: [], status: 'confirmed',
    sync_status: 'pending_push', etag: null, google_event_id: null, user_id: null,
  } as const

  function setupWith(calendars?: unknown[]) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    if (calendars) queryClient.setQueryData(calendarKeys.list(), calendars)
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, createElement(UndoProvider, { gracePeriodMs: 30_000 }, children))
    return renderHook(() => useUndoable(), { wrapper }).result
  }
  const eventBody = () => {
    const call = fetchMock.mock.calls.find(([path]) => String(path) === '/api/events')
    return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined
  }

  it('takes the default from the calendars the page loaded, so the resend is complete at once', () => {
    const actions = setupWith([
      { id: 'b0000000-0000-4000-8000-000000000000', is_primary: false, is_active: true },
      { id: CAL, is_primary: true, is_active: true },
    ])
    act(() => { actions.current.createEvent({ ...unchosen }) })
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(eventBody()).toMatchObject({ calendar_id: CAL })
    expect(createEventSchema.safeParse(eventBody()).success).toBe(true)
  })

  it('asks for the default before the insert when the list has not loaded, and resends it', async () => {
    mockSupabaseResults({ data: [{ id: CAL, is_primary: true }], error: null })
    // The insert is still on its way when the page goes, as on a real reload.
    const pending: Record<string, unknown> = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? () => undefined : () => pending) })
    const passThrough = mockSupabaseClient.from.getMockImplementation()!
    mockSupabaseClient.from.mockImplementation(((table: string) => (table === 'events' ? pending : passThrough())) as never)
    const actions = setupWith()
    act(() => { actions.current.createEvent({ ...unchosen }) })
    await vi.waitFor(() => expect(mockSupabaseClient.from).toHaveBeenCalledWith('events'))
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(eventBody()).toMatchObject({ calendar_id: CAL })
    expect(createEventSchema.safeParse(eventBody()).success).toBe(true)
    expect(mockSupabaseClient.auth.getUser).not.toHaveBeenCalled()
  })
})
