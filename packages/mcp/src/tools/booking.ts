import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getBookingToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_booking_links',
      description:
        'List all booking links. Each booking link is a shareable URL (e.g., your-app.example.com/book/30min) that allows external people to book time on your calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'create_booking_link',
      description:
        'Create a new booking link with customizable duration, availability windows, and settings. The link is accessible at /book/{slug}.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          slug: {
            type: 'string',
            description:
              'URL-safe slug for the booking link (e.g., "30min", "intro-call"). Forms part of the URL: /book/{slug}.',
          },
          name: {
            type: 'string',
            description:
              'Display name for the booking link (e.g., "Intro - 30min", "Quick Chat").',
          },
          duration_minutes: {
            type: 'number',
            description: 'Meeting duration in minutes (e.g., 30, 60).',
          },
          availability: {
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
                  description: 'Start time in HH:MM format (24-hour, e.g., "09:00").',
                },
                end: {
                  type: 'string',
                  description: 'End time in HH:MM format (24-hour, e.g., "17:00").',
                },
              },
              required: ['day', 'start', 'end'],
            },
            description:
              'Weekly availability windows. Each entry defines available hours on a specific day (e.g., [{"day": "monday", "start": "09:00", "end": "17:00"}]).',
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone for the availability windows. Defaults to user profile timezone.',
          },
          google_account_id: {
            type: 'string',
            description:
              'UUID of the Google account to check availability against and create events on. The booker\'s meeting invite originates from this account\'s email.',
          },
          conferencing: {
            type: 'boolean',
            description:
              'Auto-generate a Google Meet link for each booking. Defaults to true.',
          },
          location: {
            type: 'string',
            description: 'Default location for bookings through this link.',
          },
          notes: {
            type: 'string',
            description: 'Notes visible to bookers on the booking page.',
          },
          is_public: {
            type: 'boolean',
            description:
              'Whether this link appears on your public booking page. Set to false for private/unlisted links. Defaults to true.',
          },
          requires_approval: {
            type: 'boolean',
            description:
              'When true, bookings require manual host approval before being confirmed. Defaults to false (auto-approve).',
          },
          buffer_minutes: {
            type: 'number',
            description:
              'Buffer time in minutes before and after each booking to prevent back-to-back meetings (e.g., 15). Defaults to 0.',
          },
          minimum_notice_hours: {
            type: 'number',
            description:
              'Minimum hours in advance a booking can be made (e.g., 4 means no bookings less than 4 hours from now). Defaults to 0.',
          },
        },
        required: ['slug', 'name', 'duration_minutes', 'availability'],
      },
    },
    {
      name: 'update_booking_link',
      description:
        'Update an existing booking link. Only the provided fields are changed; omitted fields remain unchanged.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the booking link to update.' },
          slug: { type: 'string', description: 'Updated URL slug.' },
          name: { type: 'string', description: 'Updated display name.' },
          duration_minutes: { type: 'number', description: 'Updated meeting duration in minutes.' },
          availability: {
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
            description: 'Replace the weekly availability windows.',
          },
          timezone: { type: 'string', description: 'Updated timezone.' },
          google_account_id: { type: 'string', description: 'Updated Google account UUID.' },
          conferencing: { type: 'boolean', description: 'Toggle Google Meet auto-generation.' },
          location: { type: 'string', description: 'Updated default location.' },
          notes: { type: 'string', description: 'Updated notes.' },
          is_public: { type: 'boolean', description: 'Toggle public visibility.' },
          requires_approval: { type: 'boolean', description: 'Toggle approval requirement.' },
          buffer_minutes: { type: 'number', description: 'Updated buffer time in minutes.' },
          minimum_notice_hours: { type: 'number', description: 'Updated minimum notice in hours.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_booking_link',
      description:
        'Delete a booking link by its UUID. The booking URL stops working. Existing confirmed bookings are NOT cancelled — they remain on the calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the booking link to delete.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_booking_link',
      description:
        'Get full details of a booking link by its UUID, including availability windows, settings, and configuration.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the booking link to retrieve.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'book_slot',
      description:
        'Book a time slot through a booking link. Creates a booking on behalf of an external person. The booking appears as an event on the host\'s calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          booking_link_id: {
            type: 'string',
            description: 'The UUID of the booking link to book through.',
          },
          name: {
            type: 'string',
            description: 'Full name of the person booking.',
          },
          email: {
            type: 'string',
            description: 'Email address of the person booking. Used for sending confirmation.',
          },
          start_time: {
            type: 'string',
            description:
              'Start time for the booking in ISO 8601 format (e.g., "2026-06-15T14:00:00-04:00"). Must be an available slot.',
          },
          end_time: {
            type: 'string',
            description:
              'End time for the booking in ISO 8601 format (e.g., "2026-06-15T14:30:00-04:00").',
          },
          notes: {
            type: 'string',
            description: 'Optional notes from the booker (e.g., meeting agenda, context).',
          },
        },
        required: ['booking_link_id', 'name', 'email', 'start_time'],
      },
    },
    {
      name: 'list_bookings',
      description:
        'List all bookings made through a specific booking link. Returns booker information, scheduled times, and booking status (pending, confirmed, cancelled, rescheduled).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          booking_link_id: {
            type: 'string',
            description: 'The UUID of the booking link to list bookings for.',
          },
        },
        required: ['booking_link_id'],
      },
    },
    {
      name: 'get_availability',
      description:
        'Get available time slots for a booking link on specific dates. Accounts for existing events on the linked Google Calendar, existing bookings, buffer times, and minimum notice requirements. Returns bookable slots.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          booking_link_id: {
            type: 'string',
            description: 'The UUID of the booking link to check availability for.',
          },
          date: {
            type: 'string',
            description:
              'Date to check availability for in ISO 8601 format (e.g., "2026-06-15"). Returns available slots for this specific date.',
          },
          timezone: {
            type: 'string',
            description:
              'IANA timezone to return slots in (e.g., "America/New_York"). Defaults to the booking link\'s timezone.',
          },
        },
        required: ['booking_link_id', 'date'],
      },
    },
  ]
}

/** The public booking routes go by slug, and these tools take the link's id. */
async function slugOf(client: PoolendarClient, bookingLinkId: string): Promise<string> {
  const link = await client.getBookingLink(bookingLinkId)
  return link.slug
}

export function getBookingToolHandlers(
  client: PoolendarClient
): Record<string, ToolHandler> {
  return {
    list_booking_links: async () => {
      const links = await client.listBookingLinks()
      return JSON.stringify(links, null, 2)
    },

    create_booking_link: async (args) => {
      const link = await client.createBookingLink({
        slug: args.slug as string,
        name: args.name as string,
        duration_minutes: args.duration_minutes as number,
        availability: args.availability as {
          day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
          start: string
          end: string
        }[],
        timezone: args.timezone as string | undefined,
        google_account_id: args.google_account_id as string | undefined,
        conferencing: args.conferencing as boolean | undefined,
        location: args.location as string | undefined,
        notes: args.notes as string | undefined,
        is_public: args.is_public as boolean | undefined,
        requires_approval: args.requires_approval as boolean | undefined,
        buffer_minutes: args.buffer_minutes as number | undefined,
        minimum_notice_hours: args.minimum_notice_hours as number | undefined,
      })
      return JSON.stringify(link, null, 2)
    },

    update_booking_link: async (args) => {
      const { id, ...data } = args as Record<string, unknown>
      const link = await client.updateBookingLink(id as string, data)
      return JSON.stringify(link, null, 2)
    },

    delete_booking_link: async (args) => {
      await client.deleteBookingLink(args.id as string)
      return JSON.stringify({ success: true, message: 'Booking link deleted successfully.' })
    },

    get_booking_link: async (args) => {
      const link = await client.getBookingLink(args.id as string)
      return JSON.stringify(link, null, 2)
    },

    book_slot: async (args) => {
      const booking = await client.bookSlot(await slugOf(client, args.booking_link_id as string), {
        booker_name: args.name as string,
        booker_email: args.email as string,
        booker_notes: args.notes as string | undefined,
        start_time: args.start_time as string,
      })
      return JSON.stringify(booking, null, 2)
    },

    list_bookings: async (args) => {
      const bookings = await client.listBookings(args.booking_link_id as string)
      return JSON.stringify(bookings, null, 2)
    },

    get_availability: async (args) => {
      const date = args.date as string
      const result = await client.getAvailability(await slugOf(client, args.booking_link_id as string), {
        start: date,
        end: date,
        ...(args.timezone ? { timezone: args.timezone as string } : {}),
      })
      return JSON.stringify(result, null, 2)
    },
  }
}
