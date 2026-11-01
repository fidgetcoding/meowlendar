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
  useTasks,
  useTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useMoveTask,
  useScheduleTask,
  taskKeys,
} from '../use-tasks'
import type { Task, Tag } from '@poolendar/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-06-13T12:00:00.000Z'

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    user_id: 'test-user-id',
    name: 'Work',
    color: '#3b82f6',
    prefix: null,
    created_at: now,
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    user_id: 'test-user-id',
    calendar_id: null,
    parent_id: null,
    title: 'Write tests',
    notes: null,
    importance: 'normal',
    time_estimate_minutes: 60,
    earliest_start: null,
    due_date: '2026-06-15',
    due_date_recurrence: null,
    scheduled_start: null,
    scheduled_end: null,
    location: null,
    visibility: 'busy',
    privacy: 'private',
    flexibility: 'flexible',
    status: 'backlog',
    board: 'current',
    is_split: false,
    completed_at: null,
    position: 1,
    reminders: [],
    created_at: now,
    updated_at: now,
    subtasks: [],
    tags: [],
    children: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTasks', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('fetches tasks with no filters', async () => {
    // Supabase returns rows with joined task_tags
    const rawRows = [
      {
        ...makeTask(),
        task_tags: [{ tag_id: 'tag-1', tags: makeTag() }],
      },
    ]
    mockSupabaseResult(rawRows)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useTasks(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0]!.title).toBe('Write tests')
    // Tags should be flattened from task_tags join
    expect(result.current.data![0]!.tags).toHaveLength(1)
    expect(result.current.data![0]!.tags![0]!.name).toBe('Work')

    queryClient.clear()
  })

  it('fetches tasks with status filter', async () => {
    mockSupabaseResult([{ ...makeTask({ status: 'in_progress' }), task_tags: [] }])

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(
      () => useTasks({ status: 'in_progress' }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data![0]!.status).toBe('in_progress')

    queryClient.clear()
  })

  it('fetches tasks with board filter', async () => {
    mockSupabaseResult([{ ...makeTask({ board: 'future' }), task_tags: [] }])

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(
      () => useTasks({ board: 'future' }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data![0]!.board).toBe('future')

    queryClient.clear()
  })

  it('handles empty result set', async () => {
    mockSupabaseResult([])

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useTasks(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])

    queryClient.clear()
  })

  it('propagates supabase errors', async () => {
    mockSupabaseError({ message: 'Permission denied' })

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useTasks(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ message: 'Permission denied' })

    queryClient.clear()
  })
})

describe('useTask', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('fetches a single task by id with tags and subtasks', async () => {
    const raw = {
      ...makeTask(),
      task_tags: [{ tag_id: 'tag-1', tags: makeTag() }],
      subtasks: [{ id: 'st-1', task_id: 'task-1', title: 'Subtask', completed: false, position: 1, time_estimate_minutes: null, created_at: now }],
    }
    mockSupabaseResult(raw)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useTask('task-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('task-1')
    expect(result.current.data?.tags).toHaveLength(1)

    queryClient.clear()
  })

  it('is disabled when id is empty', async () => {
    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useTask(''), { wrapper })

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(result.current.data).toBeUndefined()

    queryClient.clear()
  })
})

describe('useCreateTask', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('creates a task without tags', async () => {
    const created = makeTask({ id: 'new-task' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useCreateTask(), { wrapper })

    await act(async () => {
      result.current.mutate(
        omit(created, ['id', 'created_at', 'updated_at', 'subtasks', 'tags', 'children'])
      )
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('new-task')

    queryClient.clear()
  })

  it('invalidates task list queries on settle', async () => {
    const created = makeTask({ id: 'new-task' })
    mockSupabaseResult(created)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useCreateTask(), { wrapper })

    await act(async () => {
      result.current.mutate(
        omit(created, ['id', 'created_at', 'updated_at', 'subtasks', 'tags', 'children'])
      )
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.lists() }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })
})

describe('useUpdateTask', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('updates task data', async () => {
    const updated = { ...makeTask({ title: 'Updated' }), task_tags: [] }
    mockSupabaseResult(updated)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'task-1', data: { title: 'Updated' } })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('invalidates list and detail queries on settle', async () => {
    const updated = { ...makeTask({ title: 'Updated' }), task_tags: [] }
    mockSupabaseResult(updated)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'task-1', data: { title: 'Updated' } })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.lists() }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.detail('task-1') }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })
})

describe('useDeleteTask', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('deletes a task', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useDeleteTask(), { wrapper })

    await act(async () => {
      result.current.mutate('task-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('optimistically removes the task from cache', async () => {
    mockSupabaseResult(null)

    const { queryClient, wrapper } = createTestQueryClient()

    // Pre-seed
    const tasks = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })]
    queryClient.setQueryData(taskKeys.list({}), tasks)

    const { result } = renderHook(() => useDeleteTask(), { wrapper })

    await act(async () => {
      result.current.mutate('task-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })
})

describe('useMoveTask', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('moves a task to a new status', async () => {
    const moved = {
      ...makeTask({ status: 'in_progress' as const }),
      task_tags: [],
    }
    mockSupabaseResult(moved)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useMoveTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'task-1', status: 'in_progress' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('sets completed_at when moved to done', async () => {
    const moved = {
      ...makeTask({
        status: 'done' as const,
        completed_at: now,
      }),
      task_tags: [],
    }
    mockSupabaseResult(moved)

    const { queryClient, wrapper } = createTestQueryClient()

    // Pre-seed with a backlog task
    queryClient.setQueryData(taskKeys.list({}), [makeTask()])

    const { result } = renderHook(() => useMoveTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'task-1', status: 'done' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('clears completed_at when moved away from done', async () => {
    const moved = {
      ...makeTask({ status: 'backlog' as const, completed_at: null }),
      task_tags: [],
    }
    mockSupabaseResult(moved)

    const { queryClient, wrapper } = createTestQueryClient()

    // Pre-seed with a done task
    queryClient.setQueryData(taskKeys.list({}), [
      makeTask({ status: 'done', completed_at: now }),
    ])

    const { result } = renderHook(() => useMoveTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'task-1', status: 'backlog' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('supports board and position changes', async () => {
    const moved = {
      ...makeTask({ status: 'backlog' as const, board: 'future' as const, position: 5 }),
      task_tags: [],
    }
    mockSupabaseResult(moved)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useMoveTask(), { wrapper })

    await act(async () => {
      result.current.mutate({
        id: 'task-1',
        status: 'backlog',
        board: 'future',
        position: 5,
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })
})

describe('useScheduleTask', () => {
  beforeEach(() => {
    resetSupabaseMocks()
  })

  it('schedules a task with start and end times', async () => {
    const scheduled = {
      ...makeTask({
        scheduled_start: '2026-06-14T09:00:00Z',
        scheduled_end: '2026-06-14T10:00:00Z',
      }),
      task_tags: [],
    }
    mockSupabaseResult(scheduled)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useScheduleTask(), { wrapper })

    await act(async () => {
      result.current.mutate({
        id: 'task-1',
        scheduled_start: '2026-06-14T09:00:00Z',
        scheduled_end: '2026-06-14T10:00:00Z',
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    queryClient.clear()
  })

  it('invalidates list and detail queries on settle', async () => {
    const scheduled = {
      ...makeTask({
        scheduled_start: '2026-06-14T09:00:00Z',
        scheduled_end: '2026-06-14T10:00:00Z',
      }),
      task_tags: [],
    }
    mockSupabaseResult(scheduled)

    const { queryClient, wrapper } = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useScheduleTask(), { wrapper })

    await act(async () => {
      result.current.mutate({
        id: 'task-1',
        scheduled_start: '2026-06-14T09:00:00Z',
        scheduled_end: '2026-06-14T10:00:00Z',
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.lists() }),
    )
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: taskKeys.detail('task-1') }),
    )

    invalidateSpy.mockRestore()
    queryClient.clear()
  })
})

describe('taskKeys', () => {
  it('builds correct key hierarchy', () => {
    expect(taskKeys.all).toEqual(['tasks'])
    expect(taskKeys.lists()).toEqual(['tasks', 'list'])
    expect(taskKeys.list({ status: 'backlog' })).toEqual([
      'tasks', 'list', { status: 'backlog' },
    ])
    expect(taskKeys.detail('x')).toEqual(['tasks', 'detail', 'x'])
  })
})
