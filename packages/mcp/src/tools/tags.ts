import type { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from '../types.js'

export function getTagToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_tags',
      description:
        'List all tags. Tags are colored labels used to categorize tasks (e.g., "01 URGENT", "07 CLIENT WORK"). Tags also serve as project identifiers for kanban board filtering.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'create_tag',
      description:
        'Create a new tag with a name and hex color. Tags are used to categorize and filter tasks across the task panel, kanban board, and calendar.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description:
              'Tag name (e.g., "URGENT", "WORK", "PERSONAL"). Convention: use a number prefix for ordering (e.g., "01 URGENT").',
          },
          color: {
            type: 'string',
            description:
              'Hex color code for the tag badge (e.g., "#FF5733" for red-orange). Used in tag badges throughout the UI.',
          },
          prefix: {
            type: 'string',
            description:
              'Optional number prefix for ordering (e.g., "01", "07"). Determines display order when tags are listed.',
          },
        },
        required: ['name', 'color'],
      },
    },
    {
      name: 'get_tag',
      description:
        'Get full details of a tag by its UUID, including its name, color, and prefix.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the tag to retrieve.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'update_tag',
      description:
        'Update a tag\'s name, color, or prefix. Changes are reflected immediately on all tasks using this tag.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The UUID of the tag to update.' },
          name: { type: 'string', description: 'Updated tag name.' },
          color: { type: 'string', description: 'Updated hex color code.' },
          prefix: { type: 'string', description: 'Updated number prefix.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_tag',
      description:
        'Delete a tag by its UUID. The tag is removed from all tasks that currently have it. Tasks themselves are not affected.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The UUID of the tag to delete.',
          },
        },
        required: ['id'],
      },
    },
  ]
}

export function getTagToolHandlers(client: PoolendarClient): Record<string, ToolHandler> {
  return {
    list_tags: async () => {
      const tags = await client.listTags()
      return JSON.stringify(tags, null, 2)
    },

    get_tag: async (args) => {
      const tag = await client.getTag(args.id as string)
      return JSON.stringify(tag, null, 2)
    },

    create_tag: async (args) => {
      const tag = await client.createTag({
        name: args.name as string,
        color: args.color as string,
      })
      return JSON.stringify(tag, null, 2)
    },

    update_tag: async (args) => {
      const { id, ...data } = args as Record<string, unknown>
      const tag = await client.updateTag(id as string, data)
      return JSON.stringify(tag, null, 2)
    },

    delete_tag: async (args) => {
      await client.deleteTag(args.id as string)
      return JSON.stringify({ success: true, message: 'Tag deleted successfully.' })
    },
  }
}
