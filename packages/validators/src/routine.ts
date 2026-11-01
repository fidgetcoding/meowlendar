import { z } from 'zod'
import { partialUpdate } from './partial'

export const createRoutineSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(10000).nullable().optional(),
  calendar_id: z.string().uuid().nullable().optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default('America/New_York'),
  recurrence_rule: z.string().min(1),
  location: z.string().max(500).nullable().optional(),
  visibility: z.enum(['busy', 'free']).default('busy'),
  privacy: z.enum(['private', 'public']).default('private'),
  reminders: z.array(z.object({ minutes_before: z.number().int().positive() })).max(20).default([]),
})

export const updateRoutineSchema = partialUpdate(createRoutineSchema)
