'use client'

import { readAll } from '@/lib/read-all'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Tag } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'
import { taskKeys } from './use-tasks'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const tagKeys = {
  all: ['tags'] as const,
  lists: () => [...tagKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type CreateTagInput = Omit<Tag, 'id' | 'user_id' | 'created_at'>

type UpdateTagInput = {
  id: string
  data: Partial<Omit<Tag, 'id' | 'user_id' | 'created_at'>>
}

// ---------------------------------------------------------------------------
// useTags — list all tags for the current user, ordered by prefix then name
// ---------------------------------------------------------------------------

export function useTags() {
  const supabase = createClient()

  return useQuery({
    queryKey: tagKeys.lists(),
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await readAll(supabase
        .from('tags')
        .select('*')
        .order('prefix', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }).order('id'))

      if (error) throw error
      return data as Tag[]
    },
  })
}

// ---------------------------------------------------------------------------
// useCreateTag
// ---------------------------------------------------------------------------

export function useCreateTag() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateTagInput): Promise<Tag> => {
      const { data, error } = await supabase
        .from('tags')
        .insert(input)
        .select('*')
        .single()

      if (error) throw error
      return data as Tag
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.lists() })

      const previous = queryClient.getQueriesData<Tag[]>({
        queryKey: tagKeys.lists(),
      })

      const tempId = crypto.randomUUID()
      const optimistic: Tag = {
        ...input,
        id: tempId,
        user_id: '',
        created_at: new Date().toISOString(),
      }

      queryClient.setQueriesData<Tag[]>(
        { queryKey: tagKeys.lists() },
        (old) => (old ? [...old, optimistic] : [optimistic]),
      )

      return { previous, tempId }
    },

    onSuccess: (real, _input, context) => {
      if (!context) return
      queryClient.setQueriesData<Tag[]>(
        { queryKey: tagKeys.lists() },
        (old) =>
          old
            ? old.map((t) => (t.id === context.tempId ? real : t))
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
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateTag
// ---------------------------------------------------------------------------

export function useUpdateTag() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: UpdateTagInput): Promise<Tag> => {
      const { data: updated, error } = await supabase
        .from('tags')
        .update(data)
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return updated as Tag
    },

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.lists() })

      const previous = queryClient.getQueriesData<Tag[]>({
        queryKey: tagKeys.lists(),
      })

      queryClient.setQueriesData<Tag[]>(
        { queryKey: tagKeys.lists() },
        (old) =>
          old
            ? old.map((t) => (t.id === id ? { ...t, ...data } : t))
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
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteTag — also invalidates tasks since tasks reference tags
// ---------------------------------------------------------------------------

export function useDeleteTag() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('tags').delete().eq('id', id)
      if (error) throw error
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: tagKeys.lists() })

      const previous = queryClient.getQueriesData<Tag[]>({
        queryKey: tagKeys.lists(),
      })

      queryClient.setQueriesData<Tag[]>(
        { queryKey: tagKeys.lists() },
        (old) => (old ? old.filter((t) => t.id !== id) : old),
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
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}
