import { describe, it, expect } from 'vitest'
import {
  getCalendarToolDefinitions,
  getEventToolDefinitions,
  getTaskToolDefinitions,
  getSubtaskToolDefinitions,
  getRoutineToolDefinitions,
  getTagToolDefinitions,
  getBookingToolDefinitions,
  getScheduleToolDefinitions,
  getConvertToolDefinitions,
  getSearchToolDefinitions,
  getProfileToolDefinitions,
  getBulkToolDefinitions,
} from '../tools/index.js'
import type { ToolDefinition } from '../types.js'

/** Collect every tool definition from every domain. */
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
  ]
}

describe('MCP Tool Definitions', () => {
  const tools = getAllToolDefinitions()

  // ---- Count ----

  it('registers exactly 60 tools', () => {
    expect(tools).toHaveLength(60)
  })

  // ---- Per-domain counts ----

  it('registers 2 calendar tools', () => {
    expect(getCalendarToolDefinitions()).toHaveLength(2)
  })

  it('registers 6 event tools', () => {
    expect(getEventToolDefinitions()).toHaveLength(6)
  })

  it('registers 11 task tools', () => {
    expect(getTaskToolDefinitions()).toHaveLength(11)
  })

  it('registers 6 subtask tools', () => {
    expect(getSubtaskToolDefinitions()).toHaveLength(6)
  })

  it('registers 7 routine tools', () => {
    expect(getRoutineToolDefinitions()).toHaveLength(7)
  })

  it('registers 5 tag tools', () => {
    expect(getTagToolDefinitions()).toHaveLength(5)
  })

  it('registers 8 booking tools', () => {
    expect(getBookingToolDefinitions()).toHaveLength(8)
  })

  it('registers 5 schedule tools', () => {
    expect(getScheduleToolDefinitions()).toHaveLength(5)
  })

  it('registers 1 convert tool', () => {
    expect(getConvertToolDefinitions()).toHaveLength(1)
  })

  it('registers 1 search tool', () => {
    expect(getSearchToolDefinitions()).toHaveLength(1)
  })

  it('registers 5 profile tools', () => {
    expect(getProfileToolDefinitions()).toHaveLength(5)
  })

  it('registers 3 bulk tools', () => {
    expect(getBulkToolDefinitions()).toHaveLength(3)
  })

  // ---- Structural invariants ----

  it('every tool has a non-empty name', () => {
    for (const tool of tools) {
      expect(tool.name, `tool at index ${tools.indexOf(tool)}`).toBeTruthy()
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
    }
  })

  it('every tool has a non-empty description', () => {
    for (const tool of tools) {
      expect(
        tool.description,
        `${tool.name} should have a description`
      ).toBeTruthy()
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('tool names are unique (no duplicates)', () => {
    const names = tools.map((t) => t.name)
    const unique = new Set(names)
    expect(
      unique.size,
      `Duplicate tool names detected: ${names.filter((n, i) => names.indexOf(n) !== i)}`
    ).toBe(names.length)
  })

  it('every tool has a valid inputSchema with type "object"', () => {
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined()
      expect(tool.inputSchema.type, `${tool.name} schema type`).toBe('object')
      expect(
        typeof tool.inputSchema.properties,
        `${tool.name} properties should be an object`
      ).toBe('object')
    }
  })

  it('inputSchema.required is either absent or an array of strings', () => {
    for (const tool of tools) {
      if (tool.inputSchema.required !== undefined) {
        expect(
          Array.isArray(tool.inputSchema.required),
          `${tool.name} required should be an array`
        ).toBe(true)
        for (const field of tool.inputSchema.required!) {
          expect(typeof field).toBe('string')
        }
      }
    }
  })

  it('required fields are defined in properties', () => {
    for (const tool of tools) {
      if (tool.inputSchema.required) {
        for (const field of tool.inputSchema.required) {
          expect(
            tool.inputSchema.properties,
            `${tool.name} requires "${field}" but has no properties`
          ).toBeDefined()
          expect(
            field in tool.inputSchema.properties,
            `${tool.name} requires "${field}" but it is not in properties`
          ).toBe(true)
        }
      }
    }
  })

  // ---- Specific tool shapes ----

  describe('create_task', () => {
    const tool = tools.find((t) => t.name === 'create_task')!

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('accepts scheduled_start and scheduled_end (Poolendar killer feature)', () => {
      expect(tool.inputSchema.properties).toHaveProperty('scheduled_start')
      expect(tool.inputSchema.properties).toHaveProperty('scheduled_end')
    })

    it('requires only title', () => {
      expect(tool.inputSchema.required).toEqual(['title'])
    })

    it('accepts importance, due_date, time_estimate_minutes', () => {
      expect(tool.inputSchema.properties).toHaveProperty('importance')
      expect(tool.inputSchema.properties).toHaveProperty('due_date')
      expect(tool.inputSchema.properties).toHaveProperty('time_estimate_minutes')
    })

    it('accepts tags, reminders, status, board', () => {
      expect(tool.inputSchema.properties).toHaveProperty('tags')
      expect(tool.inputSchema.properties).toHaveProperty('reminders')
      expect(tool.inputSchema.properties).toHaveProperty('status')
      expect(tool.inputSchema.properties).toHaveProperty('board')
    })

    it('accepts flexibility and visibility', () => {
      expect(tool.inputSchema.properties).toHaveProperty('flexibility')
      expect(tool.inputSchema.properties).toHaveProperty('visibility')
    })
  })

  describe('convert_item', () => {
    const tool = tools.find((t) => t.name === 'convert_item')!

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('accepts source_type, source_id, target_type', () => {
      expect(tool.inputSchema.properties).toHaveProperty('source_type')
      expect(tool.inputSchema.properties).toHaveProperty('source_id')
      expect(tool.inputSchema.properties).toHaveProperty('target_type')
    })

    it('requires source_type, source_id, target_type', () => {
      expect(tool.inputSchema.required).toEqual(
        expect.arrayContaining(['source_type', 'source_id', 'target_type'])
      )
    })

    it('source_type has enum of event/task/routine', () => {
      const sourceType = tool.inputSchema.properties.source_type as Record<string, unknown>
      expect(sourceType.enum).toEqual(['event', 'task', 'routine'])
    })

    it('accepts optional calendar_id and repeat_pattern', () => {
      expect(tool.inputSchema.properties).toHaveProperty('calendar_id')
      expect(tool.inputSchema.properties).toHaveProperty('repeat_pattern')
    })
  })

  describe('bulk_create_tasks', () => {
    const tool = tools.find((t) => t.name === 'bulk_create_tasks')!

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('accepts tasks array', () => {
      expect(tool.inputSchema.properties).toHaveProperty('tasks')
      const tasks = tool.inputSchema.properties.tasks as Record<string, unknown>
      expect(tasks.type).toBe('array')
    })

    it('requires tasks', () => {
      expect(tool.inputSchema.required).toContain('tasks')
    })

    it('task items require title', () => {
      const tasks = tool.inputSchema.properties.tasks as Record<string, unknown>
      const items = tasks.items as Record<string, unknown>
      expect(items.required).toContain('title')
    })

    it('task items accept scheduled_start/scheduled_end', () => {
      const tasks = tool.inputSchema.properties.tasks as Record<string, unknown>
      const items = tasks.items as Record<string, unknown>
      const props = items.properties as Record<string, unknown>
      expect(props).toHaveProperty('scheduled_start')
      expect(props).toHaveProperty('scheduled_end')
    })
  })

  describe('list_events', () => {
    const tool = tools.find((t) => t.name === 'list_events')!

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('accepts start and end date params', () => {
      expect(tool.inputSchema.properties).toHaveProperty('start')
      expect(tool.inputSchema.properties).toHaveProperty('end')
    })

    it('accepts optional calendar_id', () => {
      expect(tool.inputSchema.properties).toHaveProperty('calendar_id')
    })
  })

  describe('search', () => {
    const tool = tools.find((t) => t.name === 'search')!

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('requires query', () => {
      expect(tool.inputSchema.required).toContain('query')
    })

    it('accepts optional types filter', () => {
      expect(tool.inputSchema.properties).toHaveProperty('types')
      const types = tool.inputSchema.properties.types as Record<string, unknown>
      expect(types.type).toBe('array')
    })
  })

  describe('create_event', () => {
    const tool = tools.find((t) => t.name === 'create_event')!

    it('requires title, start_time, end_time', () => {
      expect(tool.inputSchema.required).toEqual(
        expect.arrayContaining(['title', 'start_time', 'end_time'])
      )
    })

    it('accepts attendees, recurrence_rule, conferencing', () => {
      expect(tool.inputSchema.properties).toHaveProperty('attendees')
      expect(tool.inputSchema.properties).toHaveProperty('recurrence_rule')
      expect(tool.inputSchema.properties).toHaveProperty('conferencing')
    })
  })

  describe('schedule_task', () => {
    const tool = tools.find((t) => t.name === 'schedule_task')!

    it('exists', () => {
      expect(tool).toBeDefined()
    })

    it('requires id, scheduled_start, scheduled_end', () => {
      expect(tool.inputSchema.required).toEqual(
        expect.arrayContaining(['id', 'scheduled_start', 'scheduled_end'])
      )
    })
  })

  // ---- Completeness: every expected tool name exists ----

  const EXPECTED_TOOL_NAMES = [
    // Calendars (1)
    'list_calendars',
  'create_calendar',
    // Events (6)
    'list_events', 'create_event', 'get_event', 'update_event', 'delete_event', 'rsvp_event',
    // Tasks (11)
    'list_tasks', 'create_task', 'get_task', 'update_task', 'delete_task',
    'move_task', 'split_task', 'schedule_task', 'close_task', 'reopen_task', 'reflow_day',
    // Subtasks (6)
    'list_subtasks', 'create_subtask', 'update_subtask', 'delete_subtask',
    'reorder_subtasks', 'complete_subtask',
    // Routines (7)
    'list_routines', 'create_routine', 'get_routine', 'update_routine', 'delete_routine',
    'complete_routine_instance', 'skip_routine_instance',
    // Tags (5)
    'list_tags', 'create_tag', 'get_tag', 'update_tag', 'delete_tag',
    // Booking (8)
    'list_booking_links', 'create_booking_link', 'update_booking_link', 'delete_booking_link',
    'get_booking_link', 'book_slot', 'list_bookings', 'get_availability',
    // Schedules (5)
    'list_schedules', 'get_schedule', 'create_schedule', 'update_schedule', 'delete_schedule',
    // Convert (1)
    'convert_item',
    // Search (1)
    'search',
    // Profile (5)
    'get_profile', 'update_profile', 'list_api_keys', 'create_api_key', 'delete_api_key',
    // Bulk (3)
    'bulk_create_tasks', 'bulk_update_tasks', 'bulk_delete_tasks',
  ]

  it('contains every expected tool name', () => {
    const actualNames = tools.map((t) => t.name)
    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(
        actualNames,
        `Missing tool: ${expected}`
      ).toContain(expected)
    }
  })

  it('expected tool list is exactly 60', () => {
    expect(EXPECTED_TOOL_NAMES).toHaveLength(60)
  })
})
