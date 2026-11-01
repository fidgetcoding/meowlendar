import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getScheduleToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_schedules',
      description:
        'List all named time-block schedules. Schedules define reusable blocks of time (e.g., "Work Hours", "Deep Focus") that can be used for future auto-scheduling constraints. This is a placeholder for upcoming auto-scheduling features.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_schedule',
      description:
        'Get full details of a schedule by its UUID, including its name and time blocks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the schedule to retrieve.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_schedule',
      description:
        'Create a named schedule with time blocks. A schedule defines when certain types of work can be auto-scheduled (e.g., "Work Hours" = Mon-Fri 9am-5pm). Placeholder for future auto-scheduling.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description:
              'Schedule name (e.g., "Work Hours", "Deep Focus", "Meetings Only").',
          },
          time_blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: {
                  type: 'string',
                  enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                  description: 'Day of the week.',
                },
                start: {
                  type: 'string',
                  description: 'Block start time in HH:MM format (24-hour, e.g., "09:00").',
                },
                end: {
                  type: 'string',
                  description: 'Block end time in HH:MM format (24-hour, e.g., "17:00").',
                },
              },
              required: ['day', 'start', 'end'],
            },
            description:
              'Time blocks defining when this schedule is active. Each block specifies a day and time range.',
          },
        },
        required: ['name', 'time_blocks'],
      },
    },
    {
      name: 'update_schedule',
      description:
        'Update an existing schedule\'s name or time blocks. Only the provided fields are changed.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the schedule to update.' },
          name: { type: 'string', description: 'Updated schedule name.' },
          time_blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: {
                  type: 'string',
                  enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                },
                start: { type: 'string' },
                end: { type: 'string' },
              },
              required: ['day', 'start', 'end'],
            },
            description: 'Replace the time blocks.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_schedule',
      description:
        'Delete a schedule by its UUID. Tasks bound to this schedule lose their scheduling constraint.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the schedule to delete.',
          },
        },
        required: ['id'],
      },
    },
  ]
}

export function getScheduleToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    list_schedules: async () => {
      const schedules = await client.listSchedules()
      return JSON.stringify(schedules, null, 2)
    },

    get_schedule: async (args) => {
      const schedule = await client.getSchedule(args.id as string)
      return JSON.stringify(schedule, null, 2)
    },

    create_schedule: async (args) => {
      const schedule = await client.createSchedule({
        name: args.name as string,
        time_blocks: args.time_blocks as { day: string; start: string; end: string }[],
      })
      return JSON.stringify(schedule, null, 2)
    },

    update_schedule: async (args) => {
      const { id, ...data } = args as Record<string, unknown>
      const schedule = await client.updateSchedule(id as string, data)
      return JSON.stringify(schedule, null, 2)
    },

    delete_schedule: async (args) => {
      await client.deleteSchedule(args.id as string)
      return JSON.stringify({ success: true, message: 'Schedule deleted successfully.' })
    },
  }
}
