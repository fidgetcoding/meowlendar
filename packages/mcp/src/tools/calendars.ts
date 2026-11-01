import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getCalendarToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_calendars',
      description:
        'List the connected Google accounts and their sub-calendars. Returns each account grouped with its calendars (id, name, color, is_primary, is_active). Use a calendar id as calendar_id when creating events or tasks so the item inherits that calendar and (for events) sends invites from the right account.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
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
  }
}
