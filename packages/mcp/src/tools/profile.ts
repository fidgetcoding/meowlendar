import type { MeowlendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getProfileToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'get_profile',
      description:
        'Get the authenticated user\'s profile and settings. Returns username, display name, company, avatar, and all preference settings (timezone, theme, default calendars, notification config, booking page branding, etc.).',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'update_profile',
      description:
        'Update the user\'s profile information or settings. Only the provided fields are changed. Settings include timezone, time format, default calendars, theme accent color, notification preferences, booking page branding, and more.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          username: {
            type: 'string',
            description:
              'Updated username. Also changes the booking page subdomain ({username}.example.com).',
          },
          display_name: {
            type: 'string',
            description: 'Updated display name.',
          },
          company: {
            type: 'string',
            description: 'Updated company name.',
          },
          settings: {
            type: 'object',
            description:
              'Settings object. Only include the settings you want to change. Available settings include: timezone (IANA), time_format ("12h"/"24h"), first_day_of_week ("sunday"/"monday"), initial_view ("day"/"week"/"month"), theme_accent_color (hex), default_task_duration_minutes, default_event_calendar_id, default_task_calendar_id, privacy_default, busy_free_default, show_weekends, dim_past_events, show_completed_tasks, and notification/telegram/booking page settings.',
            properties: {
              timezone: { type: 'string', description: 'IANA timezone (e.g., "America/New_York").' },
              time_format: { type: 'string', enum: ['12h', '24h'], description: 'Time display format.' },
              language: { type: 'string', description: 'Language code.' },
              first_day_of_week: {
                type: 'string',
                enum: ['sunday', 'monday'],
                description: 'First day of the calendar week.',
              },
              initial_view: {
                type: 'string',
                enum: ['day', 'week', 'month'],
                description: 'Default calendar view on app load.',
              },
              theme_accent_color: {
                type: 'string',
                description: 'Accent color hex code (e.g., "#6366F1").',
              },
              default_event_calendar_id: {
                type: 'string',
                description: 'Default calendar UUID for new events.',
              },
              default_task_calendar_id: {
                type: 'string',
                description: 'Default calendar UUID for new tasks (determines task color on grid).',
              },
              default_task_duration_minutes: {
                type: 'number',
                description: 'Default duration in minutes for tasks without a time estimate.',
              },
              privacy_default: {
                type: 'string',
                enum: ['private', 'public'],
                description: 'Default privacy for new tasks/routines.',
              },
              busy_free_default: {
                type: 'string',
                enum: ['busy', 'free'],
                description: 'Default busy/free status for new tasks/routines.',
              },
              show_weekends: { type: 'boolean', description: 'Show weekend columns in week view.' },
              widen_current_day: { type: 'boolean', description: 'Give the current day a wider column.' },
              dim_past_events: { type: 'boolean', description: 'Reduce opacity of past events.' },
              show_completed_tasks: { type: 'boolean', description: 'Show completed tasks on the grid.' },
              show_declined_events: { type: 'boolean', description: 'Show declined events.' },
              merge_duplicate_events: { type: 'boolean', description: 'Merge duplicate events.' },
              time_grid_start: {
                type: 'string',
                description: 'Time grid start (HH:MM, e.g., "06:00").',
              },
              time_grid_end: {
                type: 'string',
                description: 'Time grid end (HH:MM, e.g., "22:00").',
              },
              time_display_resolution: {
                type: 'number',
                description: 'Time display resolution in minutes (e.g., 15, 30).',
              },
              time_drag_resolution: {
                type: 'number',
                description: 'Time dragging snap resolution in minutes.',
              },
              undo_grace_period_seconds: {
                type: 'number',
                description: 'Undo grace period for destructive operations in seconds.',
              },
              limit_events_per_day: {
                type: 'number',
                description: 'Max events shown per day cell in month view.',
              },
              background_density: {
                type: 'string',
                enum: ['compact', 'comfortable', 'spacious'],
                description: 'Calendar row height density.',
              },
              telegram_bot_token: {
                type: 'string',
                description: 'Telegram bot token for notifications.',
              },
              telegram_chat_id: {
                type: 'string',
                description: 'Telegram chat ID for notifications.',
              },
              booking_page_title: { type: 'string', description: 'Booking page title.' },
              booking_page_welcome: { type: 'string', description: 'Booking page welcome text.' },
              booking_page_brand_color: { type: 'string', description: 'Booking page accent color hex.' },
              booking_page_show_poolendar_branding: {
                type: 'boolean',
                description: 'Show Meowlendar branding on booking pages.',
              },
            },
          },
        },
      },
    },
    {
      name: 'list_api_keys',
      description:
        'List all API keys for the authenticated user. Returns key metadata (name, prefix, last used, creation date) but NOT the full key values (those are shown only once on creation).',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'create_api_key',
      description:
        'Generate a new API key for programmatic access. The full key value (pk_...) is returned ONLY in this response and cannot be retrieved again. Store it securely. Each key can be named (e.g., "Claude Code", "n8n", "Telegram Bot") for identification.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description:
              'A descriptive name for the API key (e.g., "Claude Code", "n8n Workflow", "Telegram Bot").',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'delete_api_key',
      description:
        'Revoke an API key by its UUID. The key immediately stops working for API authentication. This action cannot be undone — a new key must be generated.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the API key to revoke.',
          },
        },
        required: ['id'],
      },
    },
  ]
}

export function getProfileToolHandlers(client: MeowlendarClient): Record<string, ToolHandler> {
  return {
    get_profile: async () => {
      const profile = await client.getProfile()
      return JSON.stringify(profile, null, 2)
    },

    update_profile: async (args) => {
      const profile = await client.updateProfile(args as Record<string, unknown>)
      return JSON.stringify(profile, null, 2)
    },

    list_api_keys: async () => {
      const keys = await client.listApiKeys()
      return JSON.stringify(keys, null, 2)
    },

    create_api_key: async (args) => {
      const key = await client.createApiKey(args.name as string)
      return JSON.stringify(key, null, 2)
    },

    delete_api_key: async (args) => {
      await client.deleteApiKey(args.id as string)
      return JSON.stringify({ success: true, message: 'API key revoked successfully.' })
    },
  }
}
