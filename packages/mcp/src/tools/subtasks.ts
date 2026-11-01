import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getSubtaskToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_subtasks',
      description:
        'List all subtasks belonging to a parent task, ordered by position. Each subtask has a title, optional time estimate, and completion status.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: {
            type: 'string',
            description: 'The UUID of the parent task whose subtasks to list.',
          },
        },
        required: ['task_id'],
      },
    },
    {
      name: 'create_subtask',
      description:
        'Add a new subtask (checklist item) to a parent task. Subtasks appear as checkable items within the task detail view. If a time estimate is provided, it contributes to the parent task\'s total calendar block duration.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: {
            type: 'string',
            description: 'The UUID of the parent task to add the subtask to.',
          },
          title: {
            type: 'string',
            description: 'Subtask title (required).',
          },
          time_estimate_minutes: {
            type: 'number',
            description:
              'Estimated time for this subtask in minutes. When set, contributes to the parent task\'s calendar block duration. If omitted, the subtask is assumed to take parent_duration / number_of_subtasks.',
          },
        },
        required: ['task_id', 'title'],
      },
    },
    {
      name: 'update_subtask',
      description:
        'Update a subtask\'s title, time estimate, or completion status. Mark a subtask as completed by setting completed to true. When all subtasks are completed, the parent task auto-completes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: {
            type: 'string',
            description: 'The UUID of the parent task.',
          },
          subtask_id: {
            type: 'string',
            description: 'The UUID of the subtask to update.',
          },
          title: {
            type: 'string',
            description: 'Updated subtask title.',
          },
          time_estimate_minutes: {
            type: 'number',
            description: 'Updated time estimate in minutes.',
          },
          completed: {
            type: 'boolean',
            description:
              'Set to true to mark the subtask as completed, false to reopen it.',
          },
        },
        required: ['task_id', 'subtask_id'],
      },
    },
    {
      name: 'delete_subtask',
      description:
        'Remove a subtask from a parent task. The subtask is permanently deleted. The parent task\'s calendar block duration is recalculated if the subtask had a time estimate.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: {
            type: 'string',
            description: 'The UUID of the parent task.',
          },
          subtask_id: {
            type: 'string',
            description: 'The UUID of the subtask to delete.',
          },
        },
        required: ['task_id', 'subtask_id'],
      },
    },
    {
      name: 'reorder_subtasks',
      description:
        'Reorder subtasks within a parent task by providing the complete list of subtask UUIDs in the desired order. The first UUID becomes position 1, second becomes position 2, and so on.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: {
            type: 'string',
            description: 'The UUID of the parent task.',
          },
          order: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of subtask UUIDs in the desired order. Must include ALL subtask UUIDs belonging to this task.',
          },
        },
        required: ['task_id', 'order'],
      },
    },
    {
      name: 'complete_subtask',
      description: 'Toggle a subtask completion status',
      inputSchema: {
        type: 'object' as const,
        properties: {
          task_id: { type: 'string', description: 'Parent task ID' },
          subtask_id: { type: 'string', description: 'Subtask ID' },
          completed: { type: 'boolean', description: 'Whether the subtask is completed' },
        },
        required: ['task_id', 'subtask_id', 'completed'],
      },
    },
  ]
}

export function getSubtaskToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    list_subtasks: async (args) => {
      const subtasks = await client.listSubtasks(args.task_id as string)
      return JSON.stringify(subtasks, null, 2)
    },

    create_subtask: async (args) => {
      const subtask = await client.createSubtask(args.task_id as string, {
        title: args.title as string,
        time_estimate_minutes: args.time_estimate_minutes as number | undefined,
      })
      return JSON.stringify(subtask, null, 2)
    },

    update_subtask: async (args) => {
      const data: Record<string, unknown> = {}
      if (args.title !== undefined) data.title = args.title
      if (args.time_estimate_minutes !== undefined) data.time_estimate_minutes = args.time_estimate_minutes
      if (args.completed !== undefined) data.completed = args.completed

      const subtask = await client.updateSubtask(
        args.task_id as string,
        args.subtask_id as string,
        data
      )
      return JSON.stringify(subtask, null, 2)
    },

    delete_subtask: async (args) => {
      await client.deleteSubtask(args.task_id as string, args.subtask_id as string)
      return JSON.stringify({ success: true, message: 'Subtask deleted successfully.' })
    },

    reorder_subtasks: async (args) => {
      const subtasks = await client.reorderSubtasks(
        args.task_id as string,
        args.order as string[]
      )
      return JSON.stringify(subtasks, null, 2)
    },

    complete_subtask: async (args) => {
      const result = await client.updateSubtask(
        args.task_id as string,
        args.subtask_id as string,
        { completed: args.completed as boolean }
      )
      return JSON.stringify(result, null, 2)
    },
  }
}
