import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getSearchToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'search',
      description:
        'Full-text search across all calendar item types: events, tasks, routines, and booking links. Matches against titles, notes content, tag names, and attendee emails across ALL time (past and future). Results are ranked by recency and relevance. A meeting that reached several calendars or Google accounts is one result unless merge is false.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description:
              'Search query string. Searches across titles, notes, tag names, and attendee emails.',
          },
          types: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['event', 'task', 'routine', 'booking_link'],
            },
            description:
              'Filter results to specific item types. Omit to search across all types.',
          },
          merge: {
            type: 'boolean',
            description: 'Default true: one result per meeting. False returns each calendar copy.',
          },
        },
        required: ['query'],
      },
    },
  ]
}

export function getSearchToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    search: async (args) => {
      const results = await client.search(
        args.query as string,
        args.types as string[] | undefined,
        undefined,
        { merge: args.merge as boolean | undefined }
      )
      return JSON.stringify(results, null, 2)
    },
  }
}
