'use client'

import { readAll } from '@/lib/read-all'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Subtask } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'
import { taskKeys } from './use-tasks'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const subtaskKeys = {
  all: ['subtasks'] as const,
  list: (taskId: string) => [...subtaskKeys.all, 'list', taskId] as const,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type CreateSubtaskInput = {
  task_id: string
  title: string
  time_estimate_minutes?: number | null
}

type UpdateSubtaskInput = {
  id: string
  task_id: string
  data: Partial<Omit<Subtask, 'id' | 'task_id' | 'created_at'>>
}

type ReorderSubtasksInput = {
  taskId: string
  subtaskIds: string[]
}

// ---------------------------------------------------------------------------
// useSubtasks — list subtasks for a task, ordered by position
// ---------------------------------------------------------------------------

export function useSubtasks(taskId: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: subtaskKeys.list(taskId),
    queryFn: async (): Promise<Subtask[]> => {
      const { data, error } = await readAll(supabase
        .from('subtasks')
        .select('*')
        .eq('task_id', taskId)
        .order('position', { ascending: true }).order('id'))

      if (error) throw error
      return data as Subtask[]
    },
    enabled: !!taskId,
  })
}

// ---------------------------------------------------------------------------
// useCreateSubtask
// ---------------------------------------------------------------------------

export function useCreateSubtask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateSubtaskInput): Promise<Subtask> => {
      // Determine next position
      const { data: existing } = await supabase
        .from('subtasks')
        .select('position')
        .eq('task_id', input.task_id)
        .order('position', { ascending: false })
        .limit(1)

      const nextPosition =
        existing && existing.length > 0 ? existing[0].position + 1 : 1

      const { data, error } = await supabase
        .from('subtasks')
        .insert({
          task_id: input.task_id,
          title: input.title,
          time_estimate_minutes: input.time_estimate_minutes ?? null,
          completed: false,
          position: nextPosition,
        })
        .select('*')
        .single()

      if (error) throw error
      return data as Subtask
    },

    onMutate: async (input) => {
      const listKey = subtaskKeys.list(input.task_id)
      await queryClient.cancelQueries({ queryKey: listKey })

      const previous = queryClient.getQueryData<Subtask[]>(listKey)

      const maxPos =
        previous && previous.length > 0
          ? Math.max(...previous.map((s) => s.position))
          : 0

      const optimistic: Subtask = {
        id: crypto.randomUUID(),
        task_id: input.task_id,
        title: input.title,
        time_estimate_minutes: input.time_estimate_minutes ?? null,
        completed: false,
        position: maxPos + 1,
        created_at: new Date().toISOString(),
      }

      queryClient.setQueryData<Subtask[]>(listKey, (old) =>
        old ? [...old, optimistic] : [optimistic],
      )

      return { previous, taskId: input.task_id, tempId: optimistic.id }
    },

    onSuccess: (real, _input, context) => {
      if (!context) return
      const listKey = subtaskKeys.list(context.taskId)
      queryClient.setQueryData<Subtask[]>(listKey, (old) =>
        old
          ? old.map((s) => (s.id === context.tempId ? real : s))
          : [real],
      )
    },

    onError: (_err, _input, context) => {
      if (!context) return
      queryClient.setQueryData(
        subtaskKeys.list(context.taskId),
        context.previous,
      )
    },

    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({
        queryKey: subtaskKeys.list(input.task_id),
      })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(input.task_id) })
      // The task lists carry subtasks for the board's progress bar.
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateSubtask
// ---------------------------------------------------------------------------

export function useUpdateSubtask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: UpdateSubtaskInput): Promise<Subtask> => {
      const { data: updated, error } = await supabase
        .from('subtasks')
        .update(data)
        .eq('id', id)
        .select('*')
        .single()

      if (error) throw error
      return updated as Subtask
    },

    onMutate: async ({ id, task_id, data }) => {
      const listKey = subtaskKeys.list(task_id)
      await queryClient.cancelQueries({ queryKey: listKey })

      const previous = queryClient.getQueryData<Subtask[]>(listKey)

      queryClient.setQueryData<Subtask[]>(listKey, (old) =>
        old
          ? old.map((s) => (s.id === id ? { ...s, ...data } : s))
          : old,
      )

      return { previous, taskId: task_id }
    },

    onError: (_err, _input, context) => {
      if (!context) return
      queryClient.setQueryData(
        subtaskKeys.list(context.taskId),
        context.previous,
      )
    },

    onSettled: (_data, _err, { task_id }) => {
      queryClient.invalidateQueries({ queryKey: subtaskKeys.list(task_id) })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(task_id) })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteSubtask
// ---------------------------------------------------------------------------

export function useDeleteSubtask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
    }: {
      id: string
      task_id: string
    }): Promise<void> => {
      const { error } = await supabase.from('subtasks').delete().eq('id', id)
      if (error) throw error
    },

    onMutate: async ({ id, task_id }) => {
      const listKey = subtaskKeys.list(task_id)
      await queryClient.cancelQueries({ queryKey: listKey })

      const previous = queryClient.getQueryData<Subtask[]>(listKey)

      queryClient.setQueryData<Subtask[]>(listKey, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      )

      return { previous, taskId: task_id }
    },

    onError: (_err, _input, context) => {
      if (!context) return
      queryClient.setQueryData(
        subtaskKeys.list(context.taskId),
        context.previous,
      )
    },

    onSettled: (_data, _err, { task_id }) => {
      queryClient.invalidateQueries({ queryKey: subtaskKeys.list(task_id) })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(task_id) })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useReorderSubtasks — batch-update positions from an ordered id array
// ---------------------------------------------------------------------------

export function useReorderSubtasks() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      taskId,
      subtaskIds,
    }: ReorderSubtasksInput): Promise<void> => {
      // Update each subtask's position based on array index
      const updates = subtaskIds.map((id, index) =>
        supabase
          .from('subtasks')
          .update({ position: index + 1 })
          .eq('id', id)
          .eq('task_id', taskId),
      )

      const results = await Promise.all(updates)
      const firstError = results.find((r) => r.error)
      if (firstError?.error) throw firstError.error
    },

    onMutate: async ({ taskId, subtaskIds }) => {
      const listKey = subtaskKeys.list(taskId)
      await queryClient.cancelQueries({ queryKey: listKey })

      const previous = queryClient.getQueryData<Subtask[]>(listKey)

      if (previous) {
        // Build a lookup by id, then reorder based on subtaskIds
        const byId = new Map(previous.map((s) => [s.id, s]))
        const reordered: Subtask[] = subtaskIds
          .map((id, index) => {
            const existing = byId.get(id)
            if (!existing) return null
            return { ...existing, position: index + 1 }
          })
          .filter((s): s is Subtask => s !== null)

        queryClient.setQueryData<Subtask[]>(listKey, reordered)
      }

      return { previous, taskId }
    },

    onError: (_err, _input, context) => {
      if (!context) return
      queryClient.setQueryData(
        subtaskKeys.list(context.taskId),
        context.previous,
      )
    },

    onSettled: (_data, _err, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: subtaskKeys.list(taskId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}
