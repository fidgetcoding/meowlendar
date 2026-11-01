import { z } from 'zod'
import { partialUpdate } from './partial'

const weeklyAvailabilitySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

export const createBookingLinkSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  duration_minutes: z.number().int().positive(),
  availability: z.array(weeklyAvailabilitySchema).min(1).max(28),
  timezone: z.string().default('America/New_York'),
  google_account_id: z.string().uuid().nullable().optional(),
  conferencing: z.boolean().default(true),
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  is_public: z.boolean().default(true),
  requires_approval: z.boolean().default(false),
  buffer_minutes: z.number().int().min(0).default(0),
  minimum_notice_hours: z.number().int().min(0).default(0),
})

export const updateBookingLinkSchema = partialUpdate(createBookingLinkSchema)

export const bookSlotSchema = z.object({
  booker_name: z.string().min(1).max(200).regex(/^[^\r\n]*$/, 'Name cannot contain line breaks'),
  booker_email: z.string().email(),
  booker_notes: z.string().max(2000).nullable().optional(),
  start_time: z.string().datetime(),
})
