import type { MeowlendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getTaskToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_tasks',
      description:
        'List tasks with optional filtering by status (backlog, in_progress, check, done) and board (current, future). Returns tasks with their tags and subtask counts.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: {
            type: 'string',
            enum: ['backlog', 'in_progress', 'check', 'done'],
            description:
              'Filter by kanban column status. Omit to return tasks in all statuses.',
          },
          board: {
            type: 'string',
            enum: ['current', 'future'],
            description:
              'Filter by board. "current" = active work, "future" = planned/experimental. Omit to return tasks from both boards.',
          },
        },
      },
    },
    {
      name: 'create_task',
      description:
        'Create a new task. IMPORTANT: When "scheduled_start" and "scheduled_end" are provided, the task appears DIRECTLY on the calendar grid at that time slot — it does NOT go to the inbox. Without scheduled times, the task lives in the task panel and kanban board only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: {
            type: 'string',
            description: 'Task title (required).',
          },
          notes: {
            type: 'string',
            description: 'Task description or notes.',
          },
          calendar_id: {
            type: 'string',
            description:
              'UUID of the calendar whose color the task inherits on the grid. Uses the default task calendar from settings if omitted.',
          },
          importance: {
            type: 'string',
            enum: ['lowest', 'low', 'normal', 'high', 'highest'],
            description: 'Task priority level. Defaults to "normal".',
          },
          time_estimate_minutes: {
            type: 'number',
            description:
              'Estimated time to complete in minutes (e.g., 60 for 1 hour). Determines calendar block length when scheduled. If omitted, the default task duration from settings is used.',
          },
          earliest_start: {
            type: 'string',
            description:
              'Earliest date the task can begin, in ISO 8601 date format (e.g., "2026-06-15"). Used for scheduling constraints.',
          },
          due_date: {
            type: 'string',
            description:
              'Due date in ISO 8601 date format (e.g., "2026-06-20"). Tasks past their due date appear in the "Overdue" section.',
          },
          due_date_recurrence: {
            type: 'string',
            description:
              'RFC 5545 RRULE string for recurring due dates (e.g., "RRULE:FREQ=WEEKLY;BYDAY=FR"). Creates a new task instance when the current one is completed.',
          },
          scheduled_start: {
            type: 'string',
            description:
              'Calendar slot start time in ISO 8601 format (e.g., "2026-06-15T14:00:00-04:00"). When set WITH scheduled_end, the task renders on the calendar grid at this time.',
          },
          scheduled_end: {
            type: 'string',
            description:
              'Calendar slot end time in ISO 8601 format (e.g., "2026-06-15T15:00:00-04:00"). Must be set together with scheduled_start.',
          },
          location: {
            type: 'string',
            description: 'Task location (free text).',
          },
          visibility: {
            type: 'string',
            enum: ['busy', 'free'],
            description: 'Whether this task blocks your calendar as busy or free. Defaults to "busy".',
          },
          privacy: {
            type: 'string',
            enum: ['private', 'public'],
            description: 'Task privacy setting. Defaults to "private".',
          },
          flexibility: {
            type: 'string',
            enum: ['flexible', 'not_flexible'],
            description:
              'Whether the task can be rescheduled by auto-scheduling. Defaults to "flexible".',
          },
          status: {
            type: 'string',
            enum: ['backlog', 'in_progress', 'check', 'done'],
            description: 'Initial kanban column. Defaults to "backlog".',
          },
          board: {
            type: 'string',
            enum: ['current', 'future'],
            description: 'Which kanban board. Defaults to "current".',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tag UUIDs to attach to the task.',
          },
          reminders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                minutes_before: {
                  type: 'number',
                  description: 'Minutes before the scheduled time to trigger the reminder.',
                },
              },
              required: ['minutes_before'],
            },
            description: 'Reminder notifications for this task.',
          },
        },
        required: ['title'],
      },
    },
    {
      name: 'get_task',
      description:
        'Get full details of a task by its UUID, including subtasks, tags, child tasks (if split), and calendar scheduling information.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the task to retrieve.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'update_task',
      description:
        'Update an existing task. Only the provided fields are changed; omitted fields remain unchanged. To schedule an unscheduled task onto the calendar, provide scheduled_start and scheduled_end.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the task to update.' },
          title: { type: 'string', description: 'Updated task title.' },
          notes: { type: 'string', description: 'Updated notes/description.' },
          calendar_id: { type: 'string', description: 'Updated calendar UUID for color inheritance.' },
          importance: {
            type: 'string',
            enum: ['lowest', 'low', 'normal', 'high', 'highest'],
            description: 'Updated priority.',
          },
          time_estimate_minutes: {
            type: 'number',
            description: 'Updated time estimate in minutes.',
          },
          earliest_start: { type: 'string', description: 'Updated earliest start date (ISO 8601 date).' },
          due_date: { type: 'string', description: 'Updated due date (ISO 8601 date).' },
          due_date_recurrence: { type: 'string', description: 'Updated recurrence rule for due date.' },
          scheduled_start: {
            type: 'string',
            description:
              'Updated calendar slot start (ISO 8601). Set both scheduled_start and scheduled_end to move the task on the calendar.',
          },
          scheduled_end: {
            type: 'string',
            description: 'Updated calendar slot end (ISO 8601).',
          },
          location: { type: 'string', description: 'Updated location.' },
          visibility: { type: 'string', enum: ['busy', 'free'], description: 'Updated busy/free.' },
          privacy: { type: 'string', enum: ['private', 'public'], description: 'Updated privacy.' },
          flexibility: {
            type: 'string',
            enum: ['flexible', 'not_flexible'],
            description: 'Updated flexibility.',
          },
          status: {
            type: 'string',
            enum: ['backlog', 'in_progress', 'check', 'done'],
            description:
              'Updated kanban status. Setting to "done" marks the task as completed.',
          },
          board: { type: 'string', enum: ['current', 'future'], description: 'Updated board.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Replace the tag list with these tag UUIDs.',
          },
          reminders: {
            type: 'array',
            items: {
              type: 'object',
              properties: { minutes_before: { type: 'number' } },
              required: ['minutes_before'],
            },
            description: 'Replace the reminder list.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_task',
      description:
        'Delete a task by its UUID. Also removes it from the calendar grid and kanban board. If the task has subtasks, they are deleted too. If it is a split parent, child tasks become standalone tasks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the task to delete.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'move_task',
      description:
        'Move a task on the kanban board by changing its status column, board, and/or position. All three are optional — pass only what changes (e.g., board alone, or position alone). Moving to "done" auto-sets the completion date; moving away from "done" clears it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the task to move.' },
          status: {
            type: 'string',
            enum: ['backlog', 'in_progress', 'check', 'done'],
            description: 'The target kanban column. Optional.',
          },
          board: {
            type: 'string',
            enum: ['current', 'future'],
            description: 'The target board ("current" or "future"). Optional.',
          },
          position: {
            type: 'number',
            description:
              'Fractional position within the column for ordering (e.g., 1.5 to place between items at 1.0 and 2.0). Optional.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'split_task',
      description:
        'Split a task into independent child tasks. If the task has subtasks, each subtask becomes its own standalone task inheriting the parent\'s tags, project, and importance. If the task has no subtasks, you must provide "chunks" to split it into N equal-duration pieces (requires the task to have a time estimate). The parent becomes a grouping container and no longer appears on the calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the task to split.',
          },
          chunks: {
            type: 'number',
            description:
              'Number of equal-duration child tasks to create (only used when the task has no subtasks). Each child gets time_estimate = parent_estimate / chunks.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'schedule_task',
      description:
        'Schedule an unscheduled task onto a specific calendar time slot. Sets the task\'s scheduled_start and scheduled_end so it appears on the calendar grid. Does NOT change the task\'s due date — due date and scheduled time are independent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the task to schedule.',
          },
          scheduled_start: {
            type: 'string',
            description:
              'Start time for the calendar slot in ISO 8601 format (e.g., "2026-06-15T14:00:00-04:00").',
          },
          scheduled_end: {
            type: 'string',
            description:
              'End time for the calendar slot in ISO 8601 format (e.g., "2026-06-15T15:00:00-04:00").',
          },
        },
        required: ['id', 'scheduled_start', 'scheduled_end'],
      },
    },
    {
      name: 'close_task',
      description: 'Mark a task as done',
      inputSchema: {
        type: 'object' as const,
        properties: { id: { type: 'string', description: 'Task ID' } },
        required: ['id'],
      },
    },
    {
      name: 'reopen_task',
      description: 'Reopen a completed task',
      inputSchema: {
        type: 'object' as const,
        properties: { id: { type: 'string', description: 'Task ID' } },
        required: ['id'],
      },
    },
    {
      name: 'reflow_day',
      description:
        "Reschedule all of a day's flexible scheduled tasks so they no longer overlap. Tasks keep their original order (by scheduled start) and their durations, and are packed back-to-back starting from the day's first flexible task. Events are never moved; non-flexible tasks are left in place. Returns the day's tasks with their new times.",
      inputSchema: {
        type: 'object' as const,
        properties: {
          date: {
            type: 'string',
            description: 'The day to reflow, in ISO 8601 date format (e.g., "2026-06-15").',
          },
          timezone: {
            type: 'string',
            description:
              'IANA timezone used to decide which tasks fall on that day (e.g., "America/New_York"). Defaults to the app timezone.',
          },
        },
        required: ['date'],
      },
    },
  ]
}

export function getTaskToolHandlers(client: MeowlendarClient): Record<string, ToolHandler> {
  return {
    list_tasks: async (args) => {
      const tasks = await client.listTasks({
        status: args.status as string | undefined,
        board: args.board as string | undefined,
      })
      return JSON.stringify(tasks, null, 2)
    },

    create_task: async (args) => {
      const { tags, ...rest } = args as Record<string, unknown>
      const body = {
        ...rest,
        title: args.title as string,
        ...(tags ? { tag_ids: tags } : {}),
      }
      const task = await client.createTask(body as any)
      return JSON.stringify(task, null, 2)
    },

    get_task: async (args) => {
      const task = await client.getTask(args.id as string)
      return JSON.stringify(task, null, 2)
    },

    update_task: async (args) => {
      const { id, tags, ...data } = args as Record<string, unknown>
      if (tags) {
        ;(data as Record<string, unknown>).tag_ids = tags
      }
      const task = await client.updateTask(id as string, data)
      return JSON.stringify(task, null, 2)
    },

    delete_task: async (args) => {
      await client.deleteTask(args.id as string)
      return JSON.stringify({ success: true, message: 'Task deleted successfully.' })
    },

    move_task: async (args) => {
      const data: { status?: string; board?: string; position?: number } = {}
      if (args.status !== undefined) data.status = args.status as string
      if (args.board !== undefined) data.board = args.board as string
      if (args.position !== undefined) data.position = args.position as number
      const task = await client.moveTask(args.id as string, data)
      return JSON.stringify(task, null, 2)
    },

    split_task: async (args) => {
      const result = await client.splitTask(
        args.id as string,
        args.chunks !== undefined ? { chunks: args.chunks as number } : undefined
      )
      return JSON.stringify(result, null, 2)
    },

    schedule_task: async (args) => {
      const task = await client.scheduleTask(args.id as string, {
        scheduled_start: args.scheduled_start as string,
        scheduled_end: args.scheduled_end as string,
      })
      return JSON.stringify(task, null, 2)
    },

    close_task: async (args) => {
      const result = await client.completeTask(args.id as string)
      return JSON.stringify(result, null, 2)
    },

    reopen_task: async (args) => {
      const result = await client.reopenTask(args.id as string)
      return JSON.stringify(result, null, 2)
    },

    reflow_day: async (args) => {
      const result = await client.reflowDay({
        date: args.date as string,
        timezone: args.timezone as string | undefined,
      })
      return JSON.stringify(result, null, 2)
    },
  }
}
