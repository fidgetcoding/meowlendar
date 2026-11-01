import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getEventToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_events',
      description:
        'List calendar events within a date range. Returns events from all connected Google Calendar accounts (or a specific calendar). Use ISO 8601 date strings for start/end.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          start: {
            type: 'string',
            description:
              'Start of date range in ISO 8601 format (e.g., "2026-06-01T00:00:00Z"). Events starting at or after this time are included.',
          },
          end: {
            type: 'string',
            description:
              'End of date range in ISO 8601 format (e.g., "2026-06-07T23:59:59Z"). Events starting before this time are included.',
          },
          calendar_id: {
            type: 'string',
            description:
              'Filter to events from a specific calendar by its UUID. Omit to return events from all active calendars.',
          },
        },
      },
    },
    {
      name: 'create_event',
      description:
        'Create a new calendar event. The event syncs bidirectionally with Google Calendar. Attendees receive email invitations from the Google account associated with the selected calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: {
            type: 'string',
            description: 'Event title (required).',
          },
          calendar_id: {
            type: 'string',
            description:
              'UUID of the calendar to create the event on. Determines which Google account sends invites. If omitted, uses the default event calendar from settings.',
          },
          start_time: {
            type: 'string',
            description:
              'Event start time in ISO 8601 format (e.g., "2026-06-15T14:00:00-04:00").',
          },
          end_time: {
            type: 'string',
            description:
              'Event end time in ISO 8601 format (e.g., "2026-06-15T15:00:00-04:00").',
          },
          notes: {
            type: 'string',
            description: 'Event description or notes.',
          },
          timezone: {
            type: 'string',
            description:
              'IANA timezone (e.g., "America/New_York"). Defaults to user profile timezone.',
          },
          is_all_day: {
            type: 'boolean',
            description:
              'Whether this is an all-day event. When true, start_time and end_time should be date-only strings (e.g., "2026-06-15").',
          },
          location: {
            type: 'string',
            description: 'Event location (free text, e.g., an address or room name).',
          },
          visibility: {
            type: 'string',
            enum: ['busy', 'free'],
            description:
              'Whether this event blocks your calendar as busy or shows as free. Defaults to "busy".',
          },
          privacy: {
            type: 'string',
            enum: ['public', 'private'],
            description: 'Event privacy setting. Defaults to "public".',
          },
          attendees: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string', description: 'Attendee email address.' },
                name: { type: 'string', description: 'Attendee display name (optional).' },
              },
              required: ['email'],
            },
            description: 'List of attendees to invite. Each attendee receives an email invitation.',
          },
          recurrence_rule: {
            type: 'string',
            description:
              'RFC 5545 RRULE string for recurring events (e.g., "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"). Omit for single events.',
          },
          conferencing: {
            type: 'boolean',
            description:
              'When true, automatically generates a Google Meet link and attaches it to the event.',
          },
          reminders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                minutes_before: {
                  type: 'number',
                  description: 'Minutes before the event to trigger the reminder.',
                },
              },
              required: ['minutes_before'],
            },
            description:
              'Reminder notifications (e.g., [{"minutes_before": 10}] for a 10-minute reminder).',
          },
        },
        required: ['title', 'start_time', 'end_time'],
      },
    },
    {
      name: 'get_event',
      description:
        'Get full details of a specific calendar event by its UUID, including attendees, reminders, recurrence rule, and Google Calendar sync status.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the event to retrieve.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'update_event',
      description:
        'Update an existing calendar event. Only the provided fields are changed; omitted fields remain unchanged. Changes sync to Google Calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the event to update.',
          },
          title: { type: 'string', description: 'New event title.' },
          start_time: { type: 'string', description: 'New start time in ISO 8601 format.' },
          end_time: { type: 'string', description: 'New end time in ISO 8601 format.' },
          notes: { type: 'string', description: 'Updated event notes/description.' },
          timezone: { type: 'string', description: 'Updated IANA timezone.' },
          is_all_day: { type: 'boolean', description: 'Toggle all-day status.' },
          location: { type: 'string', description: 'Updated location.' },
          color_override: {
            type: 'string',
            description:
              'Hex color to override the calendar default color for this event (e.g., "#FF5733"). Set to null to revert to calendar color.',
          },
          visibility: { type: 'string', enum: ['busy', 'free'], description: 'Updated busy/free status.' },
          privacy: { type: 'string', enum: ['public', 'private'], description: 'Updated privacy.' },
          attendees: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['email'],
            },
            description: 'Replace the entire attendee list.',
          },
          recurrence_rule: {
            type: 'string',
            description: 'Updated RFC 5545 RRULE string.',
          },
          reminders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                minutes_before: { type: 'number' },
              },
              required: ['minutes_before'],
            },
            description: 'Replace the reminder list.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_event',
      description:
        'Delete a calendar event by its UUID. The event is also removed from Google Calendar. This action cannot be undone via the API (use undo within 30 seconds in the UI).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the event to delete.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'rsvp_event',
      description: 'Respond to an event invitation (accept, decline, or tentative)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          event_id: { type: 'string', description: 'Event ID' },
          response: { type: 'string', enum: ['accepted', 'declined', 'tentative'], description: 'RSVP response' },
        },
        required: ['event_id', 'response'],
      },
    },
  ]
}

export function getEventToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    list_events: async (args) => {
      const events = await client.listEvents({
        start: (args.start as string | undefined) ?? new Date().toISOString(),
        end: (args.end as string | undefined) ?? new Date(Date.now() + 7 * 86400000).toISOString(),
        calendar_id: args.calendar_id as string | undefined,
      })
      return JSON.stringify(events, null, 2)
    },

    create_event: async (args) => {
      const event = await client.createEvent({
        title: args.title as string,
        calendar_id: args.calendar_id as string | undefined,
        start_time: args.start_time as string,
        end_time: args.end_time as string,
        notes: args.notes as string | undefined,
        timezone: args.timezone as string | undefined,
        is_all_day: args.is_all_day as boolean | undefined,
        location: args.location as string | undefined,
        visibility: args.visibility as 'busy' | 'free' | undefined,
        privacy: args.privacy as 'public' | 'private' | undefined,
        attendees: args.attendees
          ? (args.attendees as { email: string; name?: string }[]).map((a) => ({
              ...a,
              response_status: 'needsAction' as const,
            }))
          : undefined,
        recurrence_rule: args.recurrence_rule as string | undefined,
        reminders: args.reminders as { minutes_before: number }[] | undefined,
        ...(args.conferencing ? { conferencing: true } : {}),
      })
      return JSON.stringify(event, null, 2)
    },

    get_event: async (args) => {
      const event = await client.getEvent(args.id as string)
      return JSON.stringify(event, null, 2)
    },

    update_event: async (args) => {
      const { id, ...data } = args as Record<string, unknown>
      // Map conferencing boolean to the API's conferencing field
      if ('conferencing' in data) {
        data.conferencing = data.conferencing ? true : false
      }
      const event = await client.updateEvent(id as string, data)
      return JSON.stringify(event, null, 2)
    },

    delete_event: async (args) => {
      await client.deleteEvent(args.id as string)
      return JSON.stringify({ success: true, message: 'Event deleted successfully.' })
    },

    rsvp_event: async (args) => {
      const result = await client.rsvpEvent(args.event_id as string, { response: args.response as 'accepted' | 'declined' | 'tentative' })
      return JSON.stringify(result, null, 2)
    },
  }
}
