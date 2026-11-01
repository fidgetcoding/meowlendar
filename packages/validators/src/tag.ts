import { z } from 'zod'
import { partialUpdate } from './partial'

export const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  prefix: z.string().max(10).nullable().optional(),
})

export const updateTagSchema = partialUpdate(createTagSchema)
