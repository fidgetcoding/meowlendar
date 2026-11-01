/**
 * Shared types for MCP tool registration.
 *
 * Each domain file exports:
 *   - get*ToolDefinitions(): ToolDefinition[]
 *   - get*ToolHandlers(client): Record<string, ToolHandler>
 *
 * The main index.ts aggregates these into a single ListTools and CallTool handler.
 */

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string>
