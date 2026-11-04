import { expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { mockSupabaseClient, mockSupabaseResult, resetSupabaseMocks } from './mock-supabase'
import { createTestQueryClient } from './test-utils'
import { useCreateTask, useUpdateTask, type CreateTaskInput } from '../use-tasks'
it('does not insert a task separately when the atomic create rejects its tags', async () => {
  resetSupabaseMocks()
  mockSupabaseResult({ id: 'task', user_id: 'test-user-id', title: 'Fixture' })
  mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'tag rejected' } })
  const { wrapper, queryClient } = createTestQueryClient()
  const { result } = renderHook(() => useCreateTask(), { wrapper })
  await act(async () => {
    await expect(result.current.mutateAsync({ title: 'Fixture', user_id: 'test-user-id', tag_ids: ['bad-tag'] } as CreateTaskInput)).rejects.toMatchObject({ message: 'tag rejected' })
  })
  expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  queryClient.clear()
})

it('does not persist fields separately when atomic tag replacement fails', async () => {
  resetSupabaseMocks()
  mockSupabaseResult({ id: 'task', title: 'Changed', task_tags: [] })
  mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'tag rejected' } })
  const { wrapper, queryClient } = createTestQueryClient()
  const { result } = renderHook(() => useUpdateTask(), { wrapper })
  await act(async () => {
    await expect(result.current.mutateAsync({ id: 'task', data: { title: 'Changed', tag_ids: ['bad-tag'] } })).rejects.toMatchObject({ message: 'tag rejected' })
  })
  expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  queryClient.clear()
})
