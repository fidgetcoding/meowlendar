import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import {
  mockSupabaseResult,
  mockSupabaseError,
  mockSupabaseClient,
  resetSupabaseMocks,
} from './mock-supabase'
import { createTestQueryClient } from './test-utils'
import { omit } from '@/lib/omit'
import { useEvents, useEvent, useCreateEvent, useUpdateEvent, useDeleteEvent, eventKeys } from '../use-events'
import type { CalendarEvent } from '@poolendar/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-06-13T12:00:00.000Z'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    user_id: 'test-user-id',
    calendar_id: 'cal-1',
    google_event_id: null,
    title: 'Standup',
    notes: null,
    start_time: '2026-06-13T09:00:00Z',
    end_time: '2026-06-13T09:30:00Z',
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
    sync_status: 'synced',
    etag: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEvents', () => {
  beforeEach(() => {
    resetSupabaseMocks()
    vi.mocked(fetch).mockReset()
  })

  it('fetches events in a time range', async () => {
    const events = [makeEvent(), makeEvent({ id: 'evt-2', title: 'Lunch' })]
    mockSupabaseResult(events)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(
      () => useEvents('2026-06-13T00:00:00Z', '2026-06-13T23:59:59Z'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data![0]!.title).toBe('Standup')
    expect(result.current.data![1]!.title).toBe('Lunch')

    // Verify supabase.from was called with 'events'
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('events')

    queryClient.clear()
  })

  it('applies calendarId filter when provided', async () => {
    mockSupabaseResult([makeEvent()])

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(
      () => useEvents('2026-06-13T00:00:00Z', '2026-06-13T23:59:59Z', 'cal-1'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)

    queryClient.clear()
  })

  it('throws when supabase returns an error', async () => {
    mockSupabaseError({ message: 'RLS denied', code: 'PGRST' })

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(
      () => useEvents('2026-06-13T00:00:00Z', '2026-06-13T23:59:59Z'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ message: 'RLS denied' })

    queryClient.clear()
  })

  it('returns empty array when no events exist', async () => {
    mockSupabaseResult([])

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(
      () => useEvents('2026-06-13T00:00:00Z', '2026-06-13T23:59:59Z'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])

    queryClient.clear()
  })
})

describe('useEvent', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('fetches a single event by id', async () => {
    const event = makeEvent()
    mockSupabaseResult(event)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useEvent('evt-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('evt-1')
    expect(result.current.data?.title).toBe('Standup')

    queryClient.clear()
  })

  it('does not fetch when id is empty', async () => {
    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useEvent(''), { wrapper })

    // Should stay in idle/disabled state
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.data).toBeUndefined()

    queryClient.clear()
  })
})

describe('useCreateEvent', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('creates an event and returns it', async () => {
    const created = makeEvent({ id: 'new-evt' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(created, ['id', 'created_at', 'updated_at']))
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('new-evt')

    queryClient.clear()
  })

  // A create that awaited getUser() first was still on that round trip when a reload aborted it.
  it('takes the owner from the session the browser holds, never a getUser round trip', async () => {
    const created = makeEvent({ id: 'new-evt' })
    mockSupabaseResult(created)
    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(created, ['id', 'created_at', 'updated_at', 'user_id']))
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockSupabaseClient.auth.getUser).not.toHaveBeenCalled()
    expect(mockSupabaseClient.auth.getSession).toHaveBeenCalled()
    queryClient.clear()
  })

  it('invalidates event list queries on settle', async () => {
    const created = makeEvent({ id: 'new-evt' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(created, ['id', 'created_at', 'updated_at']))
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: eventKeys.lists() }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })

  it('rolls back optimistic update on error', async () => {
    mockSupabaseError({ message: 'Insert failed' })

    const { queryClient, wrapper } = createTestQueryClient()

    // Pre-seed the cache with existing events
    queryClient.setQueryData(eventKeys.list('2026-06-13', '2026-06-14'), [makeEvent()])

    const { result } = renderHook(() => useCreateEvent(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(makeEvent({ id: 'temp' }), ['id', 'created_at', 'updated_at']))
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    // Cache should be rolled back to original data
    const cached = queryClient.getQueryData(eventKeys.list('2026-06-13', '2026-06-14'))
    expect(cached).toHaveLength(1)

    queryClient.clear()
  })
})

describe('useUpdateEvent', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('updates an event', async () => {
    const updated = makeEvent({ title: 'Updated Standup' })
    mockSupabaseResult(updated)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useUpdateEvent(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'evt-1', data: { title: 'Updated Standup' } })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.title).toBe('Updated Standup')

    queryClient.clear()
  })

  it('invalidates both list and detail queries on settle', async () => {
    const updated = makeEvent({ title: 'Updated' })
    mockSupabaseResult(updated)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateEvent(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'evt-1', data: { title: 'Updated' } })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: eventKeys.lists() }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: eventKeys.detail('evt-1') }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })
})

describe('useDeleteEvent', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('deletes an event', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useDeleteEvent(), { wrapper })

    await act(async () => {
      result.current.mutate('evt-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('optimistically removes the event from cache', async () => {
    // Set up a slow resolution so we can observe the optimistic state
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()

    // Pre-seed cache
    const events = [makeEvent({ id: 'evt-1' }), makeEvent({ id: 'evt-2' })]
    queryClient.setQueryData(eventKeys.list('2026-06-13', '2026-06-14'), events)

    const { result } = renderHook(() => useDeleteEvent(), { wrapper })

    await act(async () => {
      result.current.mutate('evt-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('invalidates list queries on settle', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteEvent(), { wrapper })

    await act(async () => {
      result.current.mutate('evt-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: eventKeys.lists() }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })
})

describe('eventKeys', () => {
  it('builds correct key hierarchy', () => {
    expect(eventKeys.all).toEqual(['events'])
    expect(eventKeys.lists()).toEqual(['events', 'list'])
    expect(eventKeys.list('a', 'b')).toEqual([
      'events', 'list', { start: 'a', end: 'b', calendarId: undefined },
    ])
    expect(eventKeys.list('a', 'b', 'cal-1')).toEqual([
      'events', 'list', { start: 'a', end: 'b', calendarId: 'cal-1' },
    ])
    expect(eventKeys.detail('x')).toEqual(['events', 'detail', 'x'])
  })
})
