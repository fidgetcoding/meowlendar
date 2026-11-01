import type { MeowlendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getRoutineToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_routines',
      description:
        'List all routines. Routines are recurring tasks that regenerate on a schedule (e.g., daily standup, weekly review). Each routine has a repeat pattern and renders on the calendar with a dashed border and repeat icon.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'create_routine',
      description:
        'Create a new routine with a recurrence pattern. Routines appear on the calendar at their scheduled time every day/week/etc. based on the recurrence rule. Unlike events, routines do NOT sync to Google Calendar — they exist only in Meowlendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: {
            type: 'string',
            description: 'Routine title (required).',
          },
          notes: {
            type: 'string',
            description: 'Routine description or notes.',
          },
          calendar_id: {
            type: 'string',
            description:
              'UUID of the calendar whose color the routine inherits on the grid.',
          },
          start_time: {
            type: 'string',
            description:
              'Time of day the routine starts, in HH:MM format (24-hour, e.g., "09:00" for 9 AM). This is a daily time, not a full datetime.',
          },
          end_time: {
            type: 'string',
            description:
              'Time of day the routine ends, in HH:MM format (24-hour, e.g., "09:30" for 9:30 AM).',
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone (e.g., "America/New_York"). Defaults to user profile timezone.',
          },
          recurrence_rule: {
            type: 'string',
            description:
              'RFC 5545 RRULE string defining when the routine repeats (e.g., "RRULE:FREQ=DAILY" for every day, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" for Mon/Wed/Fri). Required.',
          },
          location: {
            type: 'string',
            description: 'Routine location (free text).',
          },
          visibility: {
            type: 'string',
            enum: ['busy', 'free'],
            description: 'Whether this routine blocks your calendar. Defaults to "busy".',
          },
          privacy: {
            type: 'string',
            enum: ['private', 'public'],
            description: 'Routine privacy setting. Defaults to "private".',
          },
          reminders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                minutes_before: {
                  type: 'number',
                  description: 'Minutes before the routine to trigger the reminder.',
                },
              },
              required: ['minutes_before'],
            },
            description: 'Reminder notifications for each occurrence.',
          },
        },
        required: ['title', 'start_time', 'end_time', 'recurrence_rule'],
      },
    },
    {
      name: 'get_routine',
      description:
        'Get full details of a specific routine by its UUID, including the recurrence rule, time of day, and configuration.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the routine to retrieve.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'update_routine',
      description:
        'Update an existing routine. Only the provided fields are changed; omitted fields remain unchanged.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the routine to update.' },
          title: { type: 'string', description: 'Updated routine title.' },
          notes: { type: 'string', description: 'Updated notes.' },
          calendar_id: { type: 'string', description: 'Updated calendar UUID.' },
          start_time: { type: 'string', description: 'Updated start time (HH:MM, 24-hour).' },
          end_time: { type: 'string', description: 'Updated end time (HH:MM, 24-hour).' },
          timezone: { type: 'string', description: 'Updated IANA timezone.' },
          recurrence_rule: { type: 'string', description: 'Updated RFC 5545 RRULE.' },
          location: { type: 'string', description: 'Updated location.' },
          visibility: { type: 'string', enum: ['busy', 'free'], description: 'Updated busy/free.' },
          privacy: { type: 'string', enum: ['private', 'public'], description: 'Updated privacy.' },
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
      name: 'delete_routine',
      description:
        'Delete a routine by its UUID. All future occurrences are removed from the calendar. Past completed/skipped instances are retained in history.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the routine to delete.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'complete_routine_instance',
      description: 'Mark a routine instance as completed for a specific date',
      inputSchema: {
        type: 'object' as const,
        properties: {
          routine_id: { type: 'string', description: 'Routine ID' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
        required: ['routine_id', 'date'],
      },
    },
    {
      name: 'skip_routine_instance',
      description: 'Skip a routine instance for a specific date',
      inputSchema: {
        type: 'object' as const,
        properties: {
          routine_id: { type: 'string', description: 'Routine ID' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
        required: ['routine_id', 'date'],
      },
    },
  ]
}

export function getRoutineToolHandlers(client: MeowlendarClient): Record<string, ToolHandler> {
  return {
    list_routines: async () => {
      const routines = await client.listRoutines()
      return JSON.stringify(routines, null, 2)
    },

    create_routine: async (args) => {
      const routine = await client.createRoutine({
        title: args.title as string,
        notes: args.notes as string | undefined,
        calendar_id: args.calendar_id as string | undefined,
        start_time: args.start_time as string,
        end_time: args.end_time as string,
        timezone: args.timezone as string | undefined,
        recurrence_rule: args.recurrence_rule as string,
        location: args.location as string | undefined,
        visibility: args.visibility as 'busy' | 'free' | undefined,
        privacy: args.privacy as 'private' | 'public' | undefined,
        reminders: args.reminders as { minutes_before: number }[] | undefined,
      })
      return JSON.stringify(routine, null, 2)
    },

    get_routine: async (args) => {
      const routine = await client.getRoutine(args.id as string)
      return JSON.stringify(routine, null, 2)
    },

    update_routine: async (args) => {
      const { id, ...data } = args as Record<string, unknown>
      const routine = await client.updateRoutine(id as string, data)
      return JSON.stringify(routine, null, 2)
    },

    delete_routine: async (args) => {
      await client.deleteRoutine(args.id as string)
      return JSON.stringify({ success: true, message: 'Routine deleted successfully.' })
    },

    complete_routine_instance: async (args) => {
      const result = await client.updateRoutineInstance(args.routine_id as string, args.date as string, { status: 'completed' })
      return JSON.stringify(result, null, 2)
    },

    skip_routine_instance: async (args) => {
      const result = await client.updateRoutineInstance(args.routine_id as string, args.date as string, { status: 'skipped' })
      return JSON.stringify(result, null, 2)
    },
  }
}
