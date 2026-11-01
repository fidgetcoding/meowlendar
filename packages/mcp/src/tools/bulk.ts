import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getBulkToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'bulk_create_tasks',
      description:
        'Create multiple tasks in a single operation. Each task in the array follows the same schema as create_task. Tasks with scheduled_start and scheduled_end appear directly on the calendar grid. Returns an array of created tasks (or errors for individual failures).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Task title (required).' },
                notes: { type: 'string', description: 'Task description.' },
                calendar_id: { type: 'string', description: 'Calendar UUID for color inheritance.' },
                importance: {
                  type: 'string',
                  enum: ['lowest', 'low', 'normal', 'high', 'highest'],
                  description: 'Priority level.',
                },
                time_estimate_minutes: { type: 'number', description: 'Time estimate in minutes.' },
                earliest_start: { type: 'string', description: 'Earliest start date (ISO 8601 date).' },
                due_date: { type: 'string', description: 'Due date (ISO 8601 date).' },
                scheduled_start: {
                  type: 'string',
                  description: 'Calendar slot start (ISO 8601). Places task directly on calendar grid.',
                },
                scheduled_end: {
                  type: 'string',
                  description: 'Calendar slot end (ISO 8601).',
                },
                status: {
                  type: 'string',
                  enum: ['backlog', 'in_progress', 'check', 'done'],
                  description: 'Kanban column.',
                },
                board: { type: 'string', enum: ['current', 'future'], description: 'Board.' },
                location: { type: 'string', description: 'Location.' },
                visibility: { type: 'string', enum: ['busy', 'free'] },
                privacy: { type: 'string', enum: ['private', 'public'] },
                flexibility: { type: 'string', enum: ['flexible', 'not_flexible'] },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tag UUIDs.',
                },
                reminders: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { minutes_before: { type: 'number' } },
                    required: ['minutes_before'],
                  },
                },
              },
              required: ['title'],
            },
            description: 'Array of task objects to create.',
          },
        },
        required: ['tasks'],
      },
    },
    {
      name: 'bulk_update_tasks',
      description:
        'Update multiple tasks in a single operation. Each item in the array must include the task "id" and any fields to update. Returns an array of updated tasks (or errors for individual failures).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Task UUID to update (required).' },
                title: { type: 'string', description: 'Updated title.' },
                notes: { type: 'string', description: 'Updated notes.' },
                calendar_id: { type: 'string', description: 'Updated calendar UUID.' },
                importance: {
                  type: 'string',
                  enum: ['lowest', 'low', 'normal', 'high', 'highest'],
                },
                time_estimate_minutes: { type: 'number' },
                earliest_start: { type: 'string' },
                due_date: { type: 'string' },
                scheduled_start: { type: 'string' },
                scheduled_end: { type: 'string' },
                status: { type: 'string', enum: ['backlog', 'in_progress', 'check', 'done'] },
                board: { type: 'string', enum: ['current', 'future'] },
                location: { type: 'string' },
                visibility: { type: 'string', enum: ['busy', 'free'] },
                privacy: { type: 'string', enum: ['private', 'public'] },
                flexibility: { type: 'string', enum: ['flexible', 'not_flexible'] },
                tags: { type: 'array', items: { type: 'string' } },
                reminders: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { minutes_before: { type: 'number' } },
                    required: ['minutes_before'],
                  },
                },
              },
              required: ['id'],
            },
            description: 'Array of task update objects, each with an "id" and fields to change.',
          },
        },
        required: ['tasks'],
      },
    },
    {
      name: 'bulk_delete_tasks',
      description:
        'Delete multiple tasks in a single operation. Returns success/failure status for each task ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of task UUIDs to delete.',
          },
        },
        required: ['ids'],
      },
    },
  ]
}

interface BulkResult {
  index: number
  success: boolean
  data?: unknown
  error?: string
}

export function getBulkToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    bulk_create_tasks: async (args) => {
      const tasks = args.tasks as Record<string, unknown>[]
      const results: BulkResult[] = await Promise.all(
        tasks.map(async (taskData, index) => {
          try {
            const { tags, ...rest } = taskData
            const body = { ...rest, ...(tags ? { tag_ids: tags } : {}) }
            const task = await client.createTask(body as any)
            return { index, success: true, data: task }
          } catch (err) {
            return {
              index,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        })
      )
      return JSON.stringify(results, null, 2)
    },

    bulk_update_tasks: async (args) => {
      const tasks = args.tasks as { id: string; [key: string]: unknown }[]
      const results: BulkResult[] = await Promise.all(
        tasks.map(async ({ id, tags, ...data }, index) => {
          try {
            if (tags) {
              ;(data as Record<string, unknown>).tag_ids = tags
            }
            const task = await client.updateTask(id, data)
            return { index, success: true, data: task }
          } catch (err) {
            return {
              index,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        })
      )
      return JSON.stringify(results, null, 2)
    },

    bulk_delete_tasks: async (args) => {
      const ids = args.ids as string[]
      const results: BulkResult[] = await Promise.all(
        ids.map(async (id, index) => {
          try {
            await client.deleteTask(id)
            return { index, success: true, data: { id } }
          } catch (err) {
            return {
              index,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        })
      )
      return JSON.stringify(results, null, 2)
    },
  }
}
