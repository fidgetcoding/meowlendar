'use client'

import { readAll } from '@/lib/read-all'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskStatus, TaskBoard, Tag, Subtask } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'
import { omit } from '@/lib/omit'
import { subtaskKeys } from './use-subtasks'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: TaskListFilters) => [...taskKeys.lists(), filters] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
}

// ---------------------------------------------------------------------------
// Input / filter types
// ---------------------------------------------------------------------------

type TaskListFilters = {
  status?: TaskStatus
  board?: TaskBoard
  parentId?: string
  scheduled_after?: string
  scheduled_before?: string
}

export type CreateTaskInput = Omit<
  Task,
  'id' | 'created_at' | 'updated_at' | 'subtasks' | 'tags' | 'children' | 'user_id' | 'vault_ref' | 'created_via'
> & {
  /** Chosen by the caller so a resent create (see lib/undo/unload-commit) can't duplicate it. */
  id?: string
  tag_ids?: string[]
  /**
   * Optional. Callers that already have the profile loaded can pass it; when
   * omitted or null the mutation resolves the owner from the auth session.
   * Callers used to read this off the async profile query and silently drop
   * the whole create if it hadn't resolved yet — the session is authoritative
   * and always available, so it is the safer source.
   */
  user_id?: string | null
}

export type UpdateTaskInput = {
  id: string
  data: Partial<
    Omit<Task, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'subtasks' | 'tags' | 'children'>
  > & {
    tag_ids?: string[]
  }
}

export type MoveTaskInput = {
  id: string
  status: TaskStatus
  board?: TaskBoard
  position?: number
}

export type ScheduleTaskInput = {
  id: string
  scheduled_start: string
  scheduled_end: string
}

export type SplitTaskInput = {
  id: string
  chunks?: { title: string; time_estimate_minutes?: number }[]
}

// ---------------------------------------------------------------------------
// useTasks — list with optional filters, join tags
// ---------------------------------------------------------------------------

export function useTasks(filters: TaskListFilters = {}) {
  const supabase = createClient()

  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: async (): Promise<Task[]> => {
      // Subtasks come in the same request (one embedded join, no extra round trip): the board's
      // progress bar, the panel's "2/3" and the edit form all read them from the list.
      let query = supabase
        .from('tasks')
        .select('*, task_tags(tag_id, tags(*)), subtasks(*)')
        .order('position', { ascending: true, nullsFirst: false })

      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.board) {
        query = query.eq('board', filters.board)
      }
      if (filters.parentId) {
        query = query.eq('parent_id', filters.parentId)
      }
      if (filters.scheduled_after) {
        query = query.gte('scheduled_start', filters.scheduled_after)
      }
      if (filters.scheduled_before) {
        query = query.lte('scheduled_start', filters.scheduled_before)
      }

      const { data, error } = await readAll(query.order('id'))

      if (error) throw error

      // Flatten the joined tag structure; subtasks in their list order
      return (data ?? []).map((row) => {
        const { task_tags, subtasks, ...task } = row as Record<string, unknown> & {
          task_tags?: { tag_id: string; tags: Tag }[]
          subtasks?: Subtask[]
        }
        return {
          ...task,
          tags: task_tags?.map((tt) => tt.tags).filter(Boolean) ?? [],
          subtasks: [...(subtasks ?? [])].sort((a, b) => a.position - b.position),
        } as Task
      })
    },
  })
}

// ---------------------------------------------------------------------------
// useTask — single task detail
// ---------------------------------------------------------------------------

export function useTask(id: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: async (): Promise<Task> => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, task_tags(tag_id, tags(*)), subtasks(*)')
        .eq('id', id)
        .order('position', { referencedTable: 'subtasks', ascending: true })
        .single()

      if (error) throw error

      const { task_tags, ...task } = data as Record<string, unknown> & {
        task_tags?: { tag_id: string; tags: Tag }[]
      }
      return {
        ...task,
        tags: task_tags?.map((tt) => tt.tags).filter(Boolean) ?? [],
      } as Task
    },
    enabled: !!id,
  })
}

// ---------------------------------------------------------------------------
// useCreateTask
// ---------------------------------------------------------------------------

export function useCreateTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateTaskInput): Promise<Task> => {
      const { tag_ids, ...rest } = input
      // The RPC derives ownership from auth.uid() and commits task + tags together.
      const { data, error } = await supabase.rpc('create_task_with_children', {
        p_task: { ...omit(rest, ['user_id']), created_via: 'app' }, p_tag_ids: tag_ids ?? [], p_subtasks: [],
      })
      if (error) throw error
      return data as Task
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() })

      const previous = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      })

      const tempId = input.id ?? crypto.randomUUID()
      const taskData = omit(input, ['tag_ids'])
      const optimistic: Task = {
        ...taskData,
        // The caller may not have the owner id yet (mutationFn resolves it from
        // the session). This placeholder never reaches the server and is
        // replaced by the real row on settle; nothing renders off user_id.
        user_id: taskData.user_id ?? '',
        id: tempId,
        vault_ref: null,
        created_via: 'app',
        subtasks: [],
        tags: [],
        children: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) => (old ? [...old, optimistic] : [optimistic]),
      )

      return { previous, tempId }
    },

    onSuccess: (real, _input, context) => {
      if (!context) return
      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) =>
          old ? old.map((t) => (t.id === context.tempId ? real : t)) : [real],
      )
    },

    onError: (_err, _input, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateTask
// ---------------------------------------------------------------------------

export function useUpdateTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: UpdateTaskInput): Promise<Task> => {
      const { tag_ids, ...taskData } = data
      const { data: task, error } = await supabase.rpc('update_task_with_tags', {
        p_id: id, p_patch: taskData, p_tag_ids: tag_ids ?? null,
      })
      if (error) throw error
      return task as Task
    },

    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() })
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(id) })

      const previous = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      })
      const previousDetail = queryClient.getQueryData<Task>(
        taskKeys.detail(id),
      )

      const taskData = omit(data, ['tag_ids'])

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) =>
          old
            ? old.map((t) =>
                t.id === id
                  ? { ...t, ...taskData, updated_at: new Date().toISOString() }
                  : t,
              )
            : old,
      )

      if (previousDetail) {
        queryClient.setQueryData<Task>(taskKeys.detail(id), {
          ...previousDetail,
          ...taskData,
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
          taskKeys.detail(context.id),
          context.previousDetail,
        )
      }
    },

    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(id) })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteTask
// ---------------------------------------------------------------------------

export function useDeleteTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() })
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(id) })

      const previous = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      })

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) => (old ? old.filter((t) => t.id !== id) : old),
      )

      queryClient.removeQueries({ queryKey: taskKeys.detail(id) })

      return { previous }
    },

    onError: (_err, _id, context) => {
      if (!context?.previous) return
      for (const [key, data] of context.previous) {
        queryClient.setQueryData(key, data)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useCompleteTask — toggle a task to completed status
// ---------------------------------------------------------------------------

export function useCompleteTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<Task> => {
      const { data, error } = await supabase
        .from('tasks')
        .update({
          status: 'done' as TaskStatus,
          completed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*, task_tags(tag_id, tags(*))')
        .single()

      if (error) throw error

      const { task_tags, ...rest } = data as Record<string, unknown> & {
        task_tags?: { tag_id: string; tags: Tag }[]
      }
      return {
        ...rest,
        tags: task_tags?.map((tt) => tt.tags).filter(Boolean) ?? [],
      } as Task
    },

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() })

      const previous = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      })

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) =>
          old
            ? old.map((t) =>
                t.id === id
                  ? { ...t, status: 'done' as TaskStatus, completed_at: new Date().toISOString() }
                  : t,
              )
            : old,
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
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useMoveTask — status / board / position changes with auto-field logic
// ---------------------------------------------------------------------------

export function useMoveTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
      board,
      position,
    }: MoveTaskInput): Promise<Task> => {
      const updates: Record<string, unknown> = { status }
      if (board !== undefined) updates.board = board
      if (position !== undefined) updates.position = position

      // Auto-set scheduled_start when moving to in_progress
      if (status === 'in_progress') {
        const { data: current } = await supabase
          .from('tasks')
          .select('scheduled_start')
          .eq('id', id)
          .single()

        if (!current?.scheduled_start) {
          updates.scheduled_start = new Date().toISOString()
        }
      }

      // Auto-set completed_at when moving to done
      if (status === 'done') {
        updates.completed_at = new Date().toISOString()
      }

      // Clear completed_at when moving away from done
      if (status !== 'done') {
        updates.completed_at = null
      }

      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', id)
        .select('*, task_tags(tag_id, tags(*))')
        .single()

      if (error) throw error

      const { task_tags, ...rest } = data as Record<string, unknown> & {
        task_tags?: { tag_id: string; tags: Tag }[]
      }
      return {
        ...rest,
        tags: task_tags?.map((tt) => tt.tags).filter(Boolean) ?? [],
      } as Task
    },

    onMutate: async ({ id, status, board, position }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() })

      const previous = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      })

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) =>
          old
            ? old.map((t) => {
                if (t.id !== id) return t
                const patched = {
                  ...t,
                  status,
                  updated_at: new Date().toISOString(),
                } as Task
                if (board !== undefined) patched.board = board
                if (position !== undefined) patched.position = position
                if (status === 'in_progress' && !t.scheduled_start) {
                  patched.scheduled_start = new Date().toISOString()
                }
                if (status === 'done') {
                  patched.completed_at = new Date().toISOString()
                }
                if (status !== 'done') {
                  patched.completed_at = null
                }
                return patched
              })
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
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
    },
  })
}

// ---------------------------------------------------------------------------
// useSplitTask — break a task into children from subtasks or manual chunks
// ---------------------------------------------------------------------------

export function useSplitTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, chunks }: SplitTaskInput): Promise<Task[]> => {
      // Fetch the parent task with subtasks
      const { data: parent, error: fetchError } = await supabase
        .from('tasks')
        .select('*, subtasks(*)')
        .eq('id', id)
        .order('position', { referencedTable: 'subtasks', ascending: true })
        .single()

      if (fetchError) throw fetchError

      const parentTask = parent as Task
      const subtasks = parentTask.subtasks ?? []

      // Determine children to create
      const childInputs: { title: string; time_estimate_minutes: number | null; position: number }[] =
        subtasks.length > 0
          ? subtasks.map((s, i) => ({
              title: s.title,
              time_estimate_minutes: s.time_estimate_minutes,
              position: i + 1,
            }))
          : (chunks ?? []).map((c, i) => ({
              title: c.title,
              time_estimate_minutes: c.time_estimate_minutes ?? null,
              position: i + 1,
            }))

      if (childInputs.length === 0) {
        throw new Error(
          'Task has no subtasks and no chunks were provided for splitting',
        )
      }

      // Create child tasks
      const { data: children, error: childError } = await supabase
        .from('tasks')
        .insert(
          childInputs.map((c) => ({
            user_id: parentTask.user_id,
            calendar_id: parentTask.calendar_id,
            parent_id: id,
            title: c.title,
            notes: null,
            importance: parentTask.importance,
            time_estimate_minutes: c.time_estimate_minutes,
            earliest_start: parentTask.earliest_start,
            due_date: parentTask.due_date,
            due_date_recurrence: null,
            scheduled_start: null,
            scheduled_end: null,
            location: parentTask.location,
            visibility: parentTask.visibility,
            privacy: parentTask.privacy,
            flexibility: parentTask.flexibility,
            status: parentTask.status,
            board: parentTask.board,
            is_split: false,
            completed_at: null,
            position: c.position,
            reminders: parentTask.reminders,
          })),
        )
        .select('*')

      if (childError) throw childError

      // Mark parent as split
      const { error: updateError } = await supabase
        .from('tasks')
        .update({ is_split: true })
        .eq('id', id)

      if (updateError) throw updateError

      // Delete subtasks if they were the source
      if (subtasks.length > 0) {
        const { error: deleteError } = await supabase
          .from('subtasks')
          .delete()
          .eq('task_id', id)

        if (deleteError) throw deleteError
      }

      return (children ?? []) as Task[]
    },

    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: subtaskKeys.list(id) })
    },
  })
}

// ---------------------------------------------------------------------------
// useScheduleTask — set scheduled_start and scheduled_end
// ---------------------------------------------------------------------------

export function useScheduleTask() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      scheduled_start,
      scheduled_end,
    }: ScheduleTaskInput): Promise<Task> => {
      const { data, error } = await supabase
        .from('tasks')
        .update({ scheduled_start, scheduled_end })
        .eq('id', id)
        .select('*, task_tags(tag_id, tags(*))')
        .single()

      if (error) throw error

      const { task_tags, ...rest } = data as Record<string, unknown> & {
        task_tags?: { tag_id: string; tags: Tag }[]
      }
      return {
        ...rest,
        tags: task_tags?.map((tt) => tt.tags).filter(Boolean) ?? [],
      } as Task
    },

    onMutate: async ({ id, scheduled_start, scheduled_end }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists() })
      await queryClient.cancelQueries({ queryKey: taskKeys.detail(id) })

      const previous = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      })
      const previousDetail = queryClient.getQueryData<Task>(
        taskKeys.detail(id),
      )

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) =>
          old
            ? old.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      scheduled_start,
                      scheduled_end,
                      updated_at: new Date().toISOString(),
                    }
                  : t,
              )
            : old,
      )

      if (previousDetail) {
        queryClient.setQueryData<Task>(taskKeys.detail(id), {
          ...previousDetail,
          scheduled_start,
          scheduled_end,
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
          taskKeys.detail(context.id),
          context.previousDetail,
        )
      }
    },

    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() })
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(id) })
    },
  })
}
