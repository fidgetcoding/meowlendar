import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { PoolendarClient } from '@poolendar/api-client'
import type { ToolDefinition, ToolHandler } from './types.js'
import { validateArgs } from './validate.js'
import { resolveApiConfig } from './env.js'
import { createTasksApi } from './vault/api.js'
import {
  getCalendarToolDefinitions,
  getCalendarToolHandlers,
  getEventToolDefinitions,
  getEventToolHandlers,
  getTaskToolDefinitions,
  getTaskToolHandlers,
  getSubtaskToolDefinitions,
  getSubtaskToolHandlers,
  getRoutineToolDefinitions,
  getRoutineToolHandlers,
  getTagToolDefinitions,
  getTagToolHandlers,
  getBookingToolDefinitions,
  getBookingToolHandlers,
  getScheduleToolDefinitions,
  getScheduleToolHandlers,
  getConvertToolDefinitions,
  getConvertToolHandlers,
  getSearchToolDefinitions,
  getSearchToolHandlers,
  getProfileToolDefinitions,
  getProfileToolHandlers,
  getBulkToolDefinitions,
  getBulkToolHandlers,
  getVaultToolDefinitions,
  getVaultToolHandlers,
} from './tools/index.js'

// --- Configuration ---

const { apiUrl: API_URL, apiKey: API_KEY } = resolveApiConfig()

if (!API_KEY) {
  console.error(
    'meowlendar-mcp: MEOWLENDAR_API_KEY environment variable is required.\n' +
      'Generate an API key in the app under Settings > API Keys, then set it:\n' +
      '  export MEOWLENDAR_API_KEY=pk_...'
  )
  process.exit(1)
}

// --- Server + Client ---

const server = new Server(
  { name: 'meowlendar-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

const client = new PoolendarClient({
  baseUrl: API_URL,
  apiKey: API_KEY,
})

// --- Aggregate Tool Definitions ---

function getAllToolDefinitions(): ToolDefinition[] {
  return [
    ...getCalendarToolDefinitions(),
    ...getEventToolDefinitions(),
    ...getTaskToolDefinitions(),
    ...getSubtaskToolDefinitions(),
    ...getRoutineToolDefinitions(),
    ...getTagToolDefinitions(),
    ...getBookingToolDefinitions(),
    ...getScheduleToolDefinitions(),
    ...getConvertToolDefinitions(),
    ...getSearchToolDefinitions(),
    ...getProfileToolDefinitions(),
    ...getBulkToolDefinitions(),
    ...getVaultToolDefinitions(),
  ]
}

// --- Aggregate Tool Handlers ---

function getAllToolHandlers(): Record<string, ToolHandler> {
  return {
    ...getCalendarToolHandlers(client),
    ...getEventToolHandlers(client),
    ...getTaskToolHandlers(client),
    ...getSubtaskToolHandlers(client),
    ...getRoutineToolHandlers(client),
    ...getTagToolHandlers(client),
    ...getBookingToolHandlers(client),
    ...getScheduleToolHandlers(client),
    ...getConvertToolHandlers(client),
    ...getSearchToolHandlers(client),
    ...getProfileToolHandlers(client),
    ...getBulkToolHandlers(client),
    ...getVaultToolHandlers(createTasksApi(client)),
  }
}

// --- Register MCP Handlers ---

const toolDefinitions = getAllToolDefinitions()
const toolHandlers = getAllToolHandlers()
const toolSchemas = new Map(toolDefinitions.map((t) => [t.name, t.inputSchema]))

/** One JSON line per call on stderr (stdout carries the protocol). Never logs arguments. */
function auditLog(tool: string, outcome: 'ok' | 'invalid' | 'error', startedAt: number) {
  console.error(JSON.stringify({ event: 'mcp_tool_call', tool, outcome, ms: Date.now() - startedAt }))
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const handler = toolHandlers[name]

  if (!handler) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'unknown_tool',
            message: `Tool "${name}" is not recognized. Use list_tools to see available tools.`,
          }),
        },
      ],
      isError: true,
    }
  }

  const startedAt = Date.now()
  const problems = validateArgs(args ?? {}, toolSchemas.get(name) ?? {})
  if (problems.length > 0) {
    auditLog(name, 'invalid', startedAt)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: 'invalid_arguments', problems }, null, 2),
        },
      ],
      isError: true,
    }
  }

  try {
    const result = await handler(args ?? {})
    auditLog(name, 'ok', startedAt)
    return {
      content: [{ type: 'text' as const, text: result }],
    }
  } catch (err) {
    auditLog(name, 'error', startedAt)
    const message =
      err instanceof Error ? err.message : 'An unknown error occurred'
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: number }).status
        : 500

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'api_error',
              message,
              status,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    }
  }
})

// --- Start ---

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('meowlendar-mcp: Fatal error:', err)
  process.exit(1)
})

export { server, client }
