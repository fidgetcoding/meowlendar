import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { mockSupabaseClient, resetSupabaseMocks } from './mock-supabase'
import { createTestQueryClient } from './test-utils'
import { useTasks, taskKeys } from '../use-tasks'
import { useUpdateSubtask, useCreateSubtask, useDeleteSubtask } from '../use-subtasks'

/** A query builder that records select() columns and answers with `rows`. */
function recordingBuilder(rows: unknown[], selects: string[]) {
  let offset = 0
  const builder: Record<string | symbol, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => Promise.resolve({ data: rows.slice(offset), error: null }).then(resolve)
      if (prop === 'range') return (from: number) => { offset = from; return builder }
      if (prop === 'select') return (columns: string) => { selects.push(columns); return builder }
      return () => builder
    },
  })
  return builder
}

// The board's "2/3" progress bar never showed: the task list query left subtasks out.
describe('the task list carries subtasks', () => {
  beforeEach(() => resetSupabaseMocks())

  it('selects subtasks with the tasks in the same query, ordered by position', async () => {
    const selects: string[] = []
    const rows = [{
      id: 't1', title: 'Ship booking page fix', task_tags: [],
      subtasks: [
        { id: 's3', task_id: 't1', title: 'Deploy', completed: false, position: 3 },
        { id: 's1', task_id: 't1', title: 'Fix', completed: true, position: 1 },
        { id: 's2', task_id: 't1', title: 'Test', completed: true, position: 2 },
      ],
    }]
    mockSupabaseClient.from.mockImplementation(() => recordingBuilder(rows, selects) as never)

    const { queryClient, wrapper } = createTestQueryClient()
    const { result } = renderHook(() => useTasks(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(selects[0]).toMatch(/\bsubtasks\(/)
    expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1)
    expect(result.current.data![0]!.subtasks!.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    queryClient.clear()
  })

  it.each([
    ['toggling', () => useUpdateSubtask(), { id: 's1', task_id: 't1', data: { completed: true } }],
    ['adding', () => useCreateSubtask(), { task_id: 't1', title: 'New' }],
    ['deleting', () => useDeleteSubtask(), { id: 's1', task_id: 't1' }],
  ])('refreshes the task lists after %s a subtask, so the board progress stays true', async (_label, hook, input) => {
    const { queryClient, wrapper } = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(hook as () => { mutateAsync: (i: unknown) => Promise<unknown> }, { wrapper })
    await act(async () => { await result.current.mutateAsync(input).catch(() => {}) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.lists() })
    queryClient.clear()
  })
})
