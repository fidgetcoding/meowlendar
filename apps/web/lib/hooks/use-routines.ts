'use client'

import { readAll } from '@/lib/read-all'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Routine, RoutineInstance, RoutineInstanceStatus } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const routineKeys = {
  all: ['routines'] as const,
  lists: () => [...routineKeys.all, 'list'] as const,
  detail: (id: string) => [...routineKeys.all, 'detail', id] as const,
  instances: (routineId: string, start: string, end: string) =>
    [...routineKeys.all, 'instances', { routineId, start, end }] as const,
  allInstances: () => [...routineKeys.all, 'instances'] as const,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateRoutineInput = Omit<Routine, 'id' | 'user_id' | 'created_at' | 'updated_at'>

export type UpdateRoutineInput = {
  id: string
  data: Partial<Omit<Routine, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
}

export type UpsertInstanceInput = {
  routine_id: string
  date: string
}

// ---------------------------------------------------------------------------
// useRoutines — list all routines for the current user
// ---------------------------------------------------------------------------

export function useRoutines() {
  const supabase = createClient()

  return useQuery({
    queryKey: routineKeys.lists(),
    queryFn: async (): Promise<Routine[]> => {
      const { data, error } = await readAll(supabase
        .from('routines')
        .select('*')
        .order('start_time', { ascending: true }).order('id'))

      if (error) throw error
      return data as Routine[]
    },
  })
}

// ---------------------------------------------------------------------------
// useCreateRoutine
// ---------------------------------------------------------------------------

export function useCreateRoutine() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateRoutineInput & { user_id?: string | null }): Promise<Routine> => {
      const { user_id, ...rest } = input
      // Never drop a create because the profile query is still in flight.
      let ownerId = user_id ?? null
      if (!ownerId) {
        const { data: auth, error: authError } = await supabase.auth.getUser()
        if (authError) throw authError
        if (!auth.user) throw new Error('Not authenticated')
        ownerId = auth.user.id
      }

      const { data, error } = await supabase
        .from('routines')
        .insert({ ...rest, user_id: ownerId })
        .select('*')
        .single()

      if (error) throw error
      return data as Routine
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: routineKeys.lists() })

      const previous = queryClient.getQueriesData<Routine[]>({
        queryKey: routineKeys.lists(),
      })

      const tempId = crypto.randomUUID()
      const now = new Date().toISOString()
      const optimistic: Routine = {
        ...input,
        id: tempId,
        user_id: '',
        created_at: now,
        updated_at: now,
      }

      queryClient.setQueriesData<Routine[]>(
        { queryKey: routineKeys.lists() },
        (old) => (old ? [...old, optimistic] : [optimistic]),
      )

      return { previous, tempId }
    },

    onSuccess: (real, _input, context) => {
      if (!context) return
      queryClient.setQueriesData<Routine[]>(
        { queryKey: routineKeys.lists() },
        (old) =>
          old
            ? old.map((r) => (r.id === context.tempId ? real : r))
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
      queryClient.invalidateQueries({ queryKey: routineKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateRoutine
// ---------------------------------------------------------------------------

export function useUpdateRoutine() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: UpdateRoutineInput): Promise<Routine> => {
      const { data: updated, error } = await supabase
        .from('routines')
        .update(data)
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return updated as Routine
    },

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: routineKeys.lists() })

      const previous = queryClient.getQueriesData<Routine[]>({
        queryKey: routineKeys.lists(),
      })

      queryClient.setQueriesData<Routine[]>(
        { queryKey: routineKeys.lists() },
        (old) =>
          old
            ? old.map((r) =>
                r.id === id
                  ? { ...r, ...data, updated_at: new Date().toISOString() }
                  : r,
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
      queryClient.invalidateQueries({ queryKey: routineKeys.lists() })
      queryClient.invalidateQueries({ queryKey: routineKeys.allInstances() })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteRoutine
// ---------------------------------------------------------------------------

export function useDeleteRoutine() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('routines').delete().eq('id', id)
      if (error) throw error
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: routineKeys.lists() })

      const previous = queryClient.getQueriesData<Routine[]>({
        queryKey: routineKeys.lists(),
      })

      queryClient.setQueriesData<Routine[]>(
        { queryKey: routineKeys.lists() },
        (old) => (old ? old.filter((r) => r.id !== id) : old),
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
      queryClient.invalidateQueries({ queryKey: routineKeys.lists() })
      queryClient.invalidateQueries({ queryKey: routineKeys.allInstances() })
    },
  })
}

// ---------------------------------------------------------------------------
// useRoutineInstances — instances for a routine within a date range
// ---------------------------------------------------------------------------

export function useRoutineInstances(
  routineId: string,
  startDate: string,
  endDate: string,
) {
  const supabase = createClient()

  return useQuery({
    queryKey: routineKeys.instances(routineId, startDate, endDate),
    queryFn: async (): Promise<RoutineInstance[]> => {
      const { data, error } = await readAll(supabase
        .from('routine_instances')
        .select('*')
        .eq('routine_id', routineId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true }).order('id'))

      if (error) throw error
      return data as RoutineInstance[]
    },
    enabled: !!routineId,
  })
}

// ---------------------------------------------------------------------------
// useCompleteRoutineInstance — upsert with status='completed'
// ---------------------------------------------------------------------------

export function useCompleteRoutineInstance() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      routine_id,
      date,
    }: UpsertInstanceInput): Promise<RoutineInstance> => {
      const { data, error } = await supabase
        .from('routine_instances')
        .upsert(
          {
            routine_id,
            date,
            status: 'completed' as RoutineInstanceStatus,
            completed_at: new Date().toISOString(),
          },
          { onConflict: 'routine_id,date' },
        )
        .select('*')
        .single()

      if (error) throw error
      return data as RoutineInstance
    },

    onMutate: async ({ routine_id, date }) => {
      await queryClient.cancelQueries({
        queryKey: routineKeys.allInstances(),
      })

      const previous = queryClient.getQueriesData<RoutineInstance[]>({
        queryKey: routineKeys.allInstances(),
      })

      const optimistic: RoutineInstance = {
        id: crypto.randomUUID(),
        routine_id,
        date,
        status: 'completed',
        completed_at: new Date().toISOString(),
        override_start_time: null,
        override_end_time: null,
        override_title: null,
      }

      queryClient.setQueriesData<RoutineInstance[]>(
        { queryKey: routineKeys.allInstances() },
        (old) => {
          if (!old) return [optimistic]
          const existing = old.findIndex(
            (i) => i.routine_id === routine_id && i.date === date,
          )
          if (existing >= 0) {
            return old.map((i, idx) =>
              idx === existing
                ? { ...i, status: 'completed' as RoutineInstanceStatus, completed_at: new Date().toISOString() }
                : i,
            )
          }
          return [...old, optimistic]
        },
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
      queryClient.invalidateQueries({ queryKey: routineKeys.allInstances() })
    },
  })
}

// ---------------------------------------------------------------------------
// useSkipRoutineInstance — upsert with status='skipped'
// ---------------------------------------------------------------------------

export function useSkipRoutineInstance() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      routine_id,
      date,
    }: UpsertInstanceInput): Promise<RoutineInstance> => {
      const { data, error } = await supabase
        .from('routine_instances')
        .upsert(
          {
            routine_id,
            date,
            status: 'skipped' as RoutineInstanceStatus,
            completed_at: null,
          },
          { onConflict: 'routine_id,date' },
        )
        .select('*')
        .single()

      if (error) throw error
      return data as RoutineInstance
    },

    onMutate: async ({ routine_id, date }) => {
      await queryClient.cancelQueries({
        queryKey: routineKeys.allInstances(),
      })

      const previous = queryClient.getQueriesData<RoutineInstance[]>({
        queryKey: routineKeys.allInstances(),
      })

      const optimistic: RoutineInstance = {
        id: crypto.randomUUID(),
        routine_id,
        date,
        status: 'skipped',
        completed_at: null,
        override_start_time: null,
        override_end_time: null,
        override_title: null,
      }

      queryClient.setQueriesData<RoutineInstance[]>(
        { queryKey: routineKeys.allInstances() },
        (old) => {
          if (!old) return [optimistic]
          const existing = old.findIndex(
            (i) => i.routine_id === routine_id && i.date === date,
          )
          if (existing >= 0) {
            return old.map((i, idx) =>
              idx === existing
                ? { ...i, status: 'skipped' as RoutineInstanceStatus, completed_at: null }
                : i,
            )
          }
          return [...old, optimistic]
        },
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
      queryClient.invalidateQueries({ queryKey: routineKeys.allInstances() })
    },
  })
}

// ---------------------------------------------------------------------------
// useResetRoutineInstance — delete instance row so it reverts to 'pending'
// ---------------------------------------------------------------------------

export function useResetRoutineInstance() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      routine_id,
      date,
    }: UpsertInstanceInput): Promise<void> => {
      const { error } = await supabase
        .from('routine_instances')
        .delete()
        .eq('routine_id', routine_id)
        .eq('date', date)

      if (error) throw error
    },

    onMutate: async ({ routine_id, date }) => {
      await queryClient.cancelQueries({
        queryKey: routineKeys.allInstances(),
      })

      const previous = queryClient.getQueriesData<RoutineInstance[]>({
        queryKey: routineKeys.allInstances(),
      })

      queryClient.setQueriesData<RoutineInstance[]>(
        { queryKey: routineKeys.allInstances() },
        (old) =>
          old
            ? old.filter(
                (i) => !(i.routine_id === routine_id && i.date === date),
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
      queryClient.invalidateQueries({ queryKey: routineKeys.allInstances() })
    },
  })
}

// ---------------------------------------------------------------------------
// useTodayRoutineInstances — all instances for today (for sidebar panel)
// ---------------------------------------------------------------------------

export function useTodayRoutineInstances() {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  return useQuery({
    queryKey: [...routineKeys.allInstances(), 'today', today],
    queryFn: async (): Promise<RoutineInstance[]> => {
      const { data, error } = await readAll(supabase
        .from('routine_instances')
        .select('*')
        .eq('date', today).order('id'))

      if (error) throw error
      return data as RoutineInstance[]
    },
  })
}

/** Saved completion/skip states across all visible routines; RLS scopes ownership. */
export function useCalendarRoutineInstances(start: string, end: string, enabled: boolean) {
  const supabase = createClient()
  return useQuery({
    queryKey: [...routineKeys.allInstances(), 'calendar', start, end],
    enabled,
    queryFn: async (): Promise<RoutineInstance[]> => {
      const { data, error } = await readAll(supabase.from('routine_instances').select('*')
        .gte('date', start).lte('date', end).order('id'))
      if (error) throw error
      return data as RoutineInstance[]
    },
  })
}
