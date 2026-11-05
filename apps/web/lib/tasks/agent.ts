import type { Task } from '@poolendar/types'

/**
 * "By your agent" marks tasks an agent scheduled through the API: the server records
 * `created_via: 'api'` when an API key creates a task (migration 042). Tasks made in the app
 * are 'app', and tasks from before the column existed are null, so neither gets the label.
 */
export function isAgentTask(task: Pick<Task, 'created_via'> | null | undefined): boolean {
  return task?.created_via === 'api'
}
