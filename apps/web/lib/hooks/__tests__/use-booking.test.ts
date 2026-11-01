import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import {
  mockSupabaseResult,
  mockSupabaseError,
  resetSupabaseMocks,
} from './mock-supabase'
import { createTestQueryClient } from './test-utils'
import { omit } from '@/lib/omit'
import {
  useBookingLinks,
  useCreateBookingLink,
  useUpdateBookingLink,
  useDeleteBookingLink,
  useBookings,
  useUpdateBookingStatus,
  bookingKeys,
} from '../use-booking'
import type { BookingLink, Booking } from '@poolendar/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-06-13T12:00:00.000Z'

function makeBookingLink(overrides: Partial<BookingLink> = {}): BookingLink {
  return {
    id: 'bl-1',
    user_id: 'test-user-id',
    slug: 'intro-call',
    name: 'Intro Call',
    duration_minutes: 30,
    availability: [
      { day: 'monday', start: '09:00', end: '17:00' },
      { day: 'tuesday', start: '09:00', end: '17:00' },
    ],
    timezone: 'America/New_York',
    google_account_id: null,
    conferencing: false,
    location: null,
    notes: null,
    is_public: true,
    requires_approval: false,
    buffer_minutes: 15,
    minimum_notice_hours: 24,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    booking_link_id: 'bl-1',
    booker_name: 'Jane Doe',
    booker_email: 'jane@example.com',
    booker_notes: null,
    start_time: '2026-06-14T10:00:00Z',
    end_time: '2026-06-14T10:30:00Z',
    status: 'pending',
    google_event_id: null,
    cancel_token: 'abc123',
    created_at: now,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBookingLinks', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('fetches all booking links', async () => {
    const links = [
      makeBookingLink(),
      makeBookingLink({ id: 'bl-2', name: 'Coffee Chat', slug: 'coffee' }),
    ]
    mockSupabaseResult(links)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useBookingLinks(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data![0]!.name).toBe('Intro Call')

    queryClient.clear()
  })

  it('returns empty array when no links exist', async () => {
    mockSupabaseResult([])

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useBookingLinks(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])

    queryClient.clear()
  })

  it('propagates errors', async () => {
    mockSupabaseError({ message: 'Failed' })

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useBookingLinks(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))

    queryClient.clear()
  })
})

describe('useCreateBookingLink', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('creates a booking link', async () => {
    const created = makeBookingLink({ id: 'new-bl', name: 'Strategy' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useCreateBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(created, ['id', 'user_id', 'created_at', 'updated_at']))
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.name).toBe('Strategy')

    queryClient.clear()
  })

  it('invalidates booking link queries on settle', async () => {
    const created = makeBookingLink({ id: 'new-bl' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useCreateBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(created, ['id', 'user_id', 'created_at', 'updated_at']))
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: bookingKeys.links() }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })

  it('optimistically prepends new link to cache', async () => {
    const created = makeBookingLink({ id: 'new-bl', name: 'Strategy' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    queryClient.setQueryData(bookingKeys.links(), [makeBookingLink()])

    const { result } = renderHook(() => useCreateBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate(omit(created, ['id', 'user_id', 'created_at', 'updated_at']))
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })
})

describe('useUpdateBookingLink', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('updates a booking link', async () => {
    const updated = makeBookingLink({ name: 'Updated Call', duration_minutes: 45 })
    mockSupabaseResult(updated)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useUpdateBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate({
        id: 'bl-1',
        data: { name: 'Updated Call', duration_minutes: 45 },
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.name).toBe('Updated Call')
    expect(result.current.data?.duration_minutes).toBe(45)

    queryClient.clear()
  })

  it('optimistically updates link in cache', async () => {
    const updated = makeBookingLink({ name: 'Updated' })
    mockSupabaseResult(updated)

    const { queryClient, wrapper } = createTestQueryClient()
    queryClient.setQueryData(bookingKeys.links(), [makeBookingLink()])

    const { result } = renderHook(() => useUpdateBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'bl-1', data: { name: 'Updated' } })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })
})

describe('useDeleteBookingLink', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('deletes a booking link', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useDeleteBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate('bl-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('invalidates both links and bookings queries on settle', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate('bl-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: bookingKeys.links() }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: bookingKeys.allBookings() }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })

  it('optimistically removes from cache', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()
    queryClient.setQueryData(bookingKeys.links(), [
      makeBookingLink({ id: 'bl-1' }),
      makeBookingLink({ id: 'bl-2' }),
    ])

    const { result } = renderHook(() => useDeleteBookingLink(), { wrapper })

    await act(async () => {
      result.current.mutate('bl-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })
})

describe('useBookings', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('fetches bookings for a link', async () => {
    const bookings = [makeBooking(), makeBooking({ id: 'bk-2', booker_name: 'Bob' })]
    mockSupabaseResult(bookings)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useBookings('bl-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data![0]!.booker_name).toBe('Jane Doe')

    queryClient.clear()
  })

  it('is disabled when linkId is empty', async () => {
    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useBookings(''), { wrapper })

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.data).toBeUndefined()

    queryClient.clear()
  })
})

describe('useUpdateBookingStatus', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('confirms a booking', async () => {
    const confirmed = makeBooking({ status: 'confirmed' })
    mockSupabaseResult(confirmed)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useUpdateBookingStatus(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'bk-1', status: 'confirmed' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.status).toBe('confirmed')

    queryClient.clear()
  })

  it('cancels a booking', async () => {
    const cancelled = makeBooking({ status: 'cancelled' })
    mockSupabaseResult(cancelled)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useUpdateBookingStatus(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'bk-1', status: 'cancelled' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.status).toBe('cancelled')

    queryClient.clear()
  })

  it('optimistically updates status in cache', async () => {
    const confirmed = makeBooking({ status: 'confirmed' })
    mockSupabaseResult(confirmed)

    const { queryClient, wrapper } = createTestQueryClient()
    queryClient.setQueryData(bookingKeys.bookings('bl-1'), [makeBooking()])

    const { result } = renderHook(() => useUpdateBookingStatus(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'bk-1', status: 'confirmed' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('rolls back on error', async () => {
    mockSupabaseError({ message: 'Cannot confirm' })

    const { queryClient, wrapper } = createTestQueryClient()
    const original = [makeBooking({ status: 'pending' })]
    queryClient.setQueryData(bookingKeys.bookings('bl-1'), original)

    const { result } = renderHook(() => useUpdateBookingStatus(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'bk-1', status: 'confirmed' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<Booking[]>(bookingKeys.bookings('bl-1'))
    expect(cached?.[0]?.status).toBe('pending')

    queryClient.clear()
  })
})

describe('bookingKeys', () => {
  it('builds correct key hierarchy', () => {
    expect(bookingKeys.all).toEqual(['booking'])
    expect(bookingKeys.links()).toEqual(['booking', 'links'])
    expect(bookingKeys.linkDetail('x')).toEqual(['booking', 'links', 'x'])
    expect(bookingKeys.bookings('bl-1')).toEqual(['booking', 'bookings', 'bl-1'])
    expect(bookingKeys.allBookings()).toEqual(['booking', 'bookings'])
  })
})
