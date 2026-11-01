// Adapts the REST client to the small interface the sync depends on.
import type { PoolendarClient } from '@poolendar/api-client'
import type { AppTask, TasksApi } from './types.js'

const PAGE_SIZE = 100

export type TaskClient = Pick<PoolendarClient, 'listTasks' | 'createTask' | 'updateTask'>

export function createTasksApi(client: TaskClient): TasksApi {
  return {
    async listTasks(): Promise<AppTask[]> {
      const byId = new Map<string, AppTask>()
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (;;) {
        const page = await client.listTasks({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
        for (const task of page.items) byId.set(task.id, task)
        if (!page.next_cursor) return [...byId.values()]
        if (seenCursors.has(page.next_cursor)) throw new Error('The task list repeated a page cursor.')
        seenCursors.add(page.next_cursor)
        cursor = page.next_cursor
      }
    },
    createTask: (input) => client.createTask(input),
    updateTask: (id, patch) => client.updateTask(id, patch),
  }
}
