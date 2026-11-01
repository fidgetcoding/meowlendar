import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getCalendarToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_calendars',
      description:
        'List local calendars and the connected Google accounts with their sub-calendars. Use a calendar id from here for create_event. Returns each account grouped with its calendars (id, name, color, is_primary, is_active). Use a calendar id as calendar_id when creating events or tasks so the item inherits that calendar and (for events) sends invites from the right account.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'create_calendar',
      description:
        'Create a local calendar, which has no Google account behind it. Every user already has one.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Calendar name.' },
          color: { type: 'string', description: 'Hex colour such as #f9a825.' },
        },
        required: ['name'],
      },
    },
  ]
}

export function getCalendarToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    list_calendars: async () => {
      const calendars = await client.listCalendars()
      return JSON.stringify(calendars, null, 2)
    },

    create_calendar: async (args) => {
      const calendar = await client.createCalendar({
        name: args.name as string,
        color: args.color as string | undefined,
      })
      return JSON.stringify(calendar, null, 2)
    },
  }
}
