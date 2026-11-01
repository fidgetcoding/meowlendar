import { describe, expect, it, vi } from 'vitest'
import { createTasksApi, type TaskClient } from '../../vault/api.js'
import type { AppTask } from '../../vault/types.js'

function task(id: string): AppTask {
  return { id, title: id, status: 'backlog', importance: 'normal', due_date: null, completed_at: null, vault_ref: null, created_at: '' }
}

function client(listTasks: ReturnType<typeof vi.fn>): TaskClient {
  return { listTasks, createTask: vi.fn(), updateTask: vi.fn() } as unknown as TaskClient
}

describe('createTasksApi.listTasks', () => {
  it('follows the cursor to the last page', async () => {
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [task('a'), task('b')], next_cursor: 'c1' })
      .mockResolvedValueOnce({ items: [task('c')], next_cursor: 'c2' })
      .mockResolvedValueOnce({ items: [task('d')], next_cursor: null })
    const all = await createTasksApi(client(listTasks)).listTasks()
    expect(all.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(listTasks.mock.calls.map((c) => c[0])).toEqual([
      { limit: 100 },
      { limit: 100, cursor: 'c1' },
      { limit: 100, cursor: 'c2' },
    ])
  })

  it('counts a task once if the list restarts over a deleted cursor row', async () => {
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [task('a')], next_cursor: 'c1' })
      .mockResolvedValueOnce({ items: [task('a'), task('b')], next_cursor: null })
    const all = await createTasksApi(client(listTasks)).listTasks()
    expect(all.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('stops instead of looping when a cursor repeats', async () => {
    const listTasks = vi.fn().mockResolvedValue({ items: [task('a')], next_cursor: 'same' })
    await expect(createTasksApi(client(listTasks)).listTasks()).rejects.toThrow(/repeated/)
    expect(listTasks).toHaveBeenCalledTimes(2)
  })

  it('surfaces a list failure instead of reading it as no tasks', async () => {
    const listTasks = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(createTasksApi(client(listTasks)).listTasks()).rejects.toThrow('boom')
  })
})
