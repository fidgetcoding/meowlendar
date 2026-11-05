import { z } from 'zod'

/**
 * An ISO 8601 instant, with Z or a UTC offset ("2026-06-15T14:00:00-05:00"), normalised to UTC
 * ("2026-06-15T19:00:00.000Z") so stored values compare and sort the same way whoever sent them.
 * A timestamp with no zone is still rejected: Postgres would read it as UTC and land it hours off.
 */
export function isoInstant() {
  return z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString())
}
