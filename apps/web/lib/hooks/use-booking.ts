'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { BookingLink, Booking, BookingStatus } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const bookingKeys = {
  all: ['booking'] as const,
  links: () => [...bookingKeys.all, 'links'] as const,
  linkDetail: (id: string) => [...bookingKeys.all, 'links', id] as const,
  bookings: (linkId: string) =>
    [...bookingKeys.all, 'bookings', linkId] as const,
  allBookings: () => [...bookingKeys.all, 'bookings'] as const,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type CreateBookingLinkInput = Omit<
  BookingLink,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>

type UpdateBookingLinkInput = {
  id: string
  data: Partial<
    Omit<BookingLink, 'id' | 'user_id' | 'created_at' | 'updated_at'>
  >
}

type UpdateBookingStatusInput = {
  id: string
  status: BookingStatus
}

// ---------------------------------------------------------------------------
// useBookingLinks — list all booking links for the current user
// ---------------------------------------------------------------------------

export function useBookingLinks() {
  const supabase = createClient()

  return useQuery({
    queryKey: bookingKeys.links(),
    queryFn: async (): Promise<BookingLink[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('booking_links')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as BookingLink[]
    },
  })
}

// ---------------------------------------------------------------------------
// useCreateBookingLink
// ---------------------------------------------------------------------------

export function useCreateBookingLink() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: CreateBookingLinkInput,
    ): Promise<BookingLink> => {
      const { data, error } = await supabase
        .from('booking_links')
        .insert(input)
        .select('*')
        .single()

      if (error) throw error
      return data as BookingLink
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: bookingKeys.links() })

      const previous = queryClient.getQueriesData<BookingLink[]>({
        queryKey: bookingKeys.links(),
      })

      const tempId = crypto.randomUUID()
      const now = new Date().toISOString()
      const optimistic: BookingLink = {
        ...input,
        id: tempId,
        user_id: '',
        created_at: now,
        updated_at: now,
      }

      queryClient.setQueriesData<BookingLink[]>(
        { queryKey: bookingKeys.links() },
        (old) => (old ? [optimistic, ...old] : [optimistic]),
      )

      return { previous, tempId }
    },

    onSuccess: (real, _input, context) => {
      if (!context) return
      queryClient.setQueriesData<BookingLink[]>(
        { queryKey: bookingKeys.links() },
        (old) =>
          old
            ? old.map((bl) => (bl.id === context.tempId ? real : bl))
            : [real],
      )
    },

    onError: (_err, _input, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.links() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateBookingLink
// ---------------------------------------------------------------------------

export function useUpdateBookingLink() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: UpdateBookingLinkInput): Promise<BookingLink> => {
      const { data: updated, error } = await supabase
        .from('booking_links')
        .update(data)
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return updated as BookingLink
    },

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: bookingKeys.links() })

      const previous = queryClient.getQueriesData<BookingLink[]>({
        queryKey: bookingKeys.links(),
      })

      queryClient.setQueriesData<BookingLink[]>(
        { queryKey: bookingKeys.links() },
        (old) =>
          old
            ? old.map((bl) =>
                bl.id === id
                  ? { ...bl, ...data, updated_at: new Date().toISOString() }
                  : bl,
              )
            : old,
      )

      return { previous }
    },

    onError: (_err, _input, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.links() })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteBookingLink
// ---------------------------------------------------------------------------

export function useDeleteBookingLink() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('booking_links')
        .delete()
        .eq('id', id)
      if (error) throw error
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: bookingKeys.links() })

      const previous = queryClient.getQueriesData<BookingLink[]>({
        queryKey: bookingKeys.links(),
      })

      queryClient.setQueriesData<BookingLink[]>(
        { queryKey: bookingKeys.links() },
        (old) => (old ? old.filter((bl) => bl.id !== id) : old),
      )

      return { previous }
    },

    onError: (_err, _id, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.links() })
      queryClient.invalidateQueries({ queryKey: bookingKeys.allBookings() })
    },
  })
}

// ---------------------------------------------------------------------------
// useBookings — bookings for a specific booking link
// ---------------------------------------------------------------------------

export function useBookings(linkId: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: bookingKeys.bookings(linkId),
    queryFn: async (): Promise<Booking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('booking_link_id', linkId)
        .order('start_time', { ascending: false })

      if (error) throw error
      return data as Booking[]
    },
    enabled: !!linkId,
  })
}

// ---------------------------------------------------------------------------
// useUpdateBookingStatus — confirm or cancel a booking
// ---------------------------------------------------------------------------

export function useUpdateBookingStatus() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: UpdateBookingStatusInput): Promise<Booking> => {
      const { data, error } = await supabase
        .from('bookings')
        .update({ status })
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return data as Booking
    },

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({
        queryKey: bookingKeys.allBookings(),
      })

      const previous = queryClient.getQueriesData<Booking[]>({
        queryKey: bookingKeys.allBookings(),
      })

      queryClient.setQueriesData<Booking[]>(
        { queryKey: bookingKeys.allBookings() },
        (old) =>
          old
            ? old.map((b) => (b.id === id ? { ...b, status } : b))
            : old,
      )

      return { previous }
    },

    onError: (_err, _input, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: bookingKeys.allBookings() })
    },
  })
}
