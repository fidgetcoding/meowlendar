import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getConvertToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'convert_item',
      description:
        'Convert a calendar item between types: event, task, or routine. All 6 conversion directions are supported. Side effects depend on the direction:\n' +
        '- Event -> Task/Routine: The Google Calendar event is DELETED. Attendees are notified of cancellation.\n' +
        '- Task/Routine -> Event: A new Google Calendar event is CREATED on the specified calendar. The original Supabase item is deleted.\n' +
        '- Task <-> Routine: No Google Calendar impact (both are Meowlendar-only). Task->Routine requires a repeat_pattern. Routine->Task strips recurrence.\n' +
        '- Task with subtasks -> Event/Routine: Subtasks are discarded (events/routines do not support subtasks).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          source_type: {
            type: 'string',
            enum: ['event', 'task', 'routine'],
            description: 'The type of the item being converted.',
          },
          source_id: {
            type: 'string',
            description: 'The UUID of the item to convert.',
          },
          target_type: {
            type: 'string',
            enum: ['event', 'task', 'routine'],
            description: 'The type to convert the item into. Must be different from source_type.',
          },
          calendar_id: {
            type: 'string',
            description:
              'Calendar UUID for creating a Google Calendar event (required when target_type is "event"). Determines which Google account the event syncs to.',
          },
          repeat_pattern: {
            type: 'string',
            description:
              'RFC 5545 RRULE string (required when converting to a routine, e.g., "RRULE:FREQ=DAILY"). Ignored for other target types.',
          },
        },
        required: ['source_type', 'source_id', 'target_type'],
      },
    },
  ]
}

export function getConvertToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    convert_item: async (args) => {
      const result = await client.convert({
        source_type: args.source_type as string,
        source_id: args.source_id as string,
        target_type: args.target_type as string,
        ...(args.calendar_id ? { calendar_id: args.calendar_id as string } : {}),
        ...(args.repeat_pattern ? { repeat_pattern: args.repeat_pattern as string } : {}),
      })
      return JSON.stringify(result, null, 2)
    },
  }
}
