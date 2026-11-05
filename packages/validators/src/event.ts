import { z } from 'zod'
import { isoInstant } from './instant'
import { partialUpdate } from './partial'

const attendeeSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
})

const reminderSchema = z.object({
  minutes_before: z.number().int().positive(),
})

export const createEventSchema = z.object({
  calendar_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  notes: z.string().max(10000).nullable().optional(),
  start_time: isoInstant(),
  end_time: isoInstant(),
  timezone: z.string().default('America/New_York'),
  is_all_day: z.boolean().default(false),
  location: z.string().max(500).nullable().optional(),
  color_override: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  visibility: z.enum(['busy', 'free']).default('busy'),
  privacy: z.enum(['public', 'private']).default('public'),
  conferencing: z.boolean().default(false),
  recurrence_rule: z.string().nullable().optional(),
  attendees: z.array(attendeeSchema).max(200).default([]),
  reminders: z.array(reminderSchema).max(20).default([]),
})

export const updateEventSchema = partialUpdate(createEventSchema).extend({
  // Which occurrences of a recurring event this edit touches. `occurrence_start`
  // names the one being edited; `scope_dates` lists them for 'custom'.
  scope: z.enum(['single', 'future', 'all', 'custom']).optional(),
  occurrence_start: isoInstant().optional(),
  scope_dates: z.array(isoInstant()).max(366).optional(),
})

export const rsvpSchema = z.object({
  response: z.enum(['accepted', 'declined', 'tentative']),
})

export const deleteEventQuerySchema = z.object({
  scope: z.enum(['single', 'future', 'all', 'custom']).optional(),
  occurrence_start: isoInstant().optional(),
  scope_dates: z.array(isoInstant()).max(366).optional(),
})
