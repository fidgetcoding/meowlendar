import { z } from 'zod'
import { partialUpdate } from './partial'

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(10000).nullable().optional(),
  calendar_id: z.string().uuid().nullable().optional(),
  importance: z.enum(['lowest', 'low', 'normal', 'high', 'highest']).default('normal'),
  time_estimate_minutes: z.number().int().positive().nullable().optional(),
  earliest_start: z.string().date().nullable().optional(),
  due_date: z.string().date().nullable().optional(),
  due_date_recurrence: z.string().nullable().optional(),
  scheduled_start: z.string().datetime().nullable().optional(),
  scheduled_end: z.string().datetime().nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  visibility: z.enum(['busy', 'free']).default('busy'),
  privacy: z.enum(['private', 'public']).default('private'),
  flexibility: z.enum(['flexible', 'not_flexible']).default('flexible'),
  status: z.enum(['backlog', 'in_progress', 'check', 'done']).default('backlog'),
  board: z.enum(['current', 'future']).default('current'),
  tag_ids: z.array(z.string().uuid()).max(50).default([]),
  reminders: z.array(z.object({ minutes_before: z.number().int().positive() })).max(20).default([]),
  subtasks: z.array(z.object({
    title: z.string().min(1).max(500),
    time_estimate_minutes: z.number().int().positive().nullable().optional(),
  })).max(100).optional(),
})

export const updateTaskSchema = partialUpdate(createTaskSchema)

// A move can change any of column (status), board, or intra-column position.
// All three are optional so a board-only or position-only reorder is valid
// (previously `status` was required and board-only moves 400'd). At least one
// field must be present.
export const moveTaskSchema = z
  .object({
    status: z.enum(['backlog', 'in_progress', 'check', 'done']).optional(),
    board: z.enum(['current', 'future']).optional(),
    position: z.number().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.board !== undefined || v.position !== undefined,
    { message: 'Provide at least one of status, board, or position' }
  )

// Reschedule a day's flexible scheduled tasks to resolve overlaps (spec #75).
export const reflowSchema = z.object({
  date: z.string().date(),
  timezone: z.string().min(1).max(100).optional(),
})

export const splitTaskSchema = z.object({
  chunks: z.number().int().min(2).max(20).optional(),
})

export const scheduleTaskSchema = z.object({
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
})

export const createSubtaskSchema = z.object({
  title: z.string().min(1).max(500),
  time_estimate_minutes: z.number().int().positive().nullable().optional(),
})

export const updateSubtaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  time_estimate_minutes: z.number().int().positive().nullable().optional(),
  completed: z.boolean().optional(),
})

export const reorderSubtasksSchema = z.object({
  subtask_ids: z.array(z.string().uuid()).max(200),
})
