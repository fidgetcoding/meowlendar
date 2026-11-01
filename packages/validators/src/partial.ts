import { z } from 'zod'

/**
 * Partial schema for PATCH bodies. Plain `.partial()` is unsafe here: since Zod 4
 * a default still fires under `.optional()`, so a PATCH naming one field would
 * reset every defaulted field (task status, event attendees) to its default.
 */
export function partialUpdate<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => {
      const field = value as unknown as z.ZodType
      const base = field instanceof z.ZodDefault ? (field.removeDefault() as z.ZodType) : field
      return [key, base.optional()]
    }),
  )
  return z.object(shape) as unknown as ReturnType<z.ZodObject<T>['partial']>
}
