import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getSearchToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'search',
      description:
        'Full-text search across all calendar item types: events, tasks, routines, and booking links. Matches against titles, notes content, tag names, and attendee emails across ALL time (past and future). Results are ranked by recency and relevance.',
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
        args.types as string[] | undefined
      )
      return JSON.stringify(results, null, 2)
    },
  }
}
