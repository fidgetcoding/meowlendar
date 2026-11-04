'use client'

import { readAll } from '@/lib/read-all'
import { deleteEventSeries } from '@/lib/recurrence-edit'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CalendarEvent } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'
import { eventsInWindowFilter } from '@/lib/recurrence'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const eventKeys = {
  all: ['events'] as const,
  lists: () => [...eventKeys.all, 'list'] as const,
  list: (start: string, end: string, calendarId?: string) =>
    [...eventKeys.lists(), { start, end, calendarId }] as const,
  detail: (id: string) => [...eventKeys.all, 'detail', id] as const,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateEventInput = Omit<
  CalendarEvent,
  'id' | 'created_at' | 'updated_at' | 'user_id' | 'calendar_id'
> & {
  user_id?: string | null
  /** Left empty, the event goes on the user's default calendar. */
  calendar_id?: string | null
}

export type UpdateEventInput = {
  id: string
  data: Partial<Omit<CalendarEvent, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
}

// ---------------------------------------------------------------------------
// useEvents — list events in a time range
// ---------------------------------------------------------------------------

export function useEvents(start: string, end: string, calendarId?: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: eventKeys.list(start, end, calendarId),
    queryFn: async (): Promise<CalendarEvent[]> => {
      let query = supabase
        .from('events')
        .select('*')
        .or(eventsInWindowFilter(start, end))
        .order('start_time', { ascending: true })

      if (calendarId) {
        query = query.eq('calendar_id', calendarId)
      }

      const { data, error } = await readAll(query.order('id'))

      if (error) throw error
      return data as CalendarEvent[]
    },
  })
}

// ---------------------------------------------------------------------------
// useEvent — single event detail
// ---------------------------------------------------------------------------

export function useEvent(id: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: async (): Promise<CalendarEvent> => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single()

      if (error) throw error
      return data as CalendarEvent
    },
    enabled: !!id,
  })
}

/**
 * The calendar a new event goes on when none was chosen: the primary Google calendar,
 * else the first one turned on. Asked at save time, because a quick-create can happen
 * before the browser has loaded the calendar list.
 */
async function defaultCalendarId(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('calendars')
    .select('id, is_primary')
    .eq('user_id', ownerId)
    .eq('is_active', true)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  const id = data?.[0]?.id as string | undefined
  if (!id) throw new Error('Turn on a calendar before creating an event')
  return id
}

// ---------------------------------------------------------------------------
// useCreateEvent
// ---------------------------------------------------------------------------

export function useCreateEvent() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ user_id, calendar_id, ...rest }: CreateEventInput): Promise<CalendarEvent> => {
      // Never drop a create because the profile query is still in flight.
      let ownerId = user_id ?? null
      if (!ownerId) {
        const { data: auth, error: authError } = await supabase.auth.getUser()
        if (authError) throw authError
        if (!auth.user) throw new Error('Not authenticated')
        ownerId = auth.user.id
      }

      const { data, error } = await supabase
        .from('events')
        .insert({
          ...rest,
          user_id: ownerId,
          calendar_id: calendar_id ?? (await defaultCalendarId(supabase, ownerId)),
        })
        .select('*')
        .single()

      if (error) throw error
      return data as CalendarEvent
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: eventKeys.lists() })

      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: eventKeys.lists(),
      })

      const tempId = crypto.randomUUID()
      const optimistic: CalendarEvent = {
        ...input,
        user_id: input.user_id ?? '',
        calendar_id: input.calendar_id ?? '',
        id: tempId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) => (old ? [...old, optimistic] : [optimistic]),
      )

      return { previous, tempId }
    },

    onSuccess: (real, _input, context) => {
      if (!context) return
      // Replace the temp-id entry with the real record
      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old
            ? old.map((e) => (e.id === context.tempId ? real : e))
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
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateEvent
// ---------------------------------------------------------------------------

export function useUpdateEvent() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: UpdateEventInput): Promise<CalendarEvent> => {
      const { data: updated, error } = await supabase
        .from('events')
        .update(data)
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return updated as CalendarEvent
    },

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: eventKeys.lists() })
      await queryClient.cancelQueries({ queryKey: eventKeys.detail(id) })

      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: eventKeys.lists(),
      })
      const previousDetail = queryClient.getQueryData<CalendarEvent>(
        eventKeys.detail(id),
      )

      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) =>
          old
            ? old.map((e) =>
                e.id === id
                  ? { ...e, ...data, updated_at: new Date().toISOString() }
                  : e,
              )
            : old,
      )

      if (previousDetail) {
        queryClient.setQueryData<CalendarEvent>(eventKeys.detail(id), {
          ...previousDetail,
          ...data,
          updated_at: new Date().toISOString(),
        })
      }

      return { previous, previousDetail, id }
    },

    onError: (_err, _input, context) => {
      if (!context) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
      if (context.previousDetail) {
        queryClient.setQueryData(
          eventKeys.detail(context.id),
          context.previousDetail,
        )
      }
    },

    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteEvent
// ---------------------------------------------------------------------------

export function useDeleteEvent() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data: event, error } = await supabase.from('events').select('*').eq('id', id).single()
      if (error) throw error
      if (event) await deleteEventSeries(supabase, event)
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: eventKeys.lists() })
      await queryClient.cancelQueries({ queryKey: eventKeys.detail(id) })

      const previous = queryClient.getQueriesData<CalendarEvent[]>({
        queryKey: eventKeys.lists(),
      })

      queryClient.setQueriesData<CalendarEvent[]>(
        { queryKey: eventKeys.lists() },
        (old) => (old ? old.filter((e) => e.id !== id) : old),
      )

      queryClient.removeQueries({ queryKey: eventKeys.detail(id) })

      return { previous }
    },

    onError: (_err, _id, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useRecurringEventChange: edits and deletes that touch part of a series. The
// server does the split, so these go through the API rather than Supabase.
// ---------------------------------------------------------------------------

export interface RecurringEventChange {
  id: string
  scope: 'single' | 'future' | 'all' | 'custom'
  occurrenceStart?: string | null
  dates?: string[]
  /** Fields to change. Leave out to delete. */
  patch?: Record<string, unknown>
}

export function useRecurringEventChange() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, scope, occurrenceStart, dates, patch }: RecurringEventChange) => {
      let res: Response
      if (patch) {
        res = await fetch(`/api/events/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...patch,
            scope,
            occurrence_start: occurrenceStart ?? undefined,
            scope_dates: dates,
          }),
        })
      } else {
        const params = new URLSearchParams({ scope })
        if (occurrenceStart) params.set('occurrence_start', occurrenceStart)
        for (const date of dates ?? []) params.append('scope_dates', date)
        res = await fetch(`/api/events/${encodeURIComponent(id)}?${params}`, { method: 'DELETE' })
      }
      if (!res.ok) throw new Error('Failed to change the recurring event')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.all })
    },
  })
}
