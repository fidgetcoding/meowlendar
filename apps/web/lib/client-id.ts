import type { SupabaseClient } from '@supabase/supabase-js'

// A create can carry the id the browser chose for it. The page sends the same create again while
// it unloads (lib/undo/unload-commit), and the id makes the second one a no-op instead of a copy.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** The browser-chosen id on a create body, when it's a well-formed UUID. */
export function clientIdOf(body: unknown): string | null {
  const id = body && typeof body === 'object' ? (body as { id?: unknown }).id : undefined
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null
}

/** The row this user already has under that id: the same create, arriving a second time. */
export async function alreadyCreated(
  supabase: Pick<SupabaseClient, 'from'>,
  table: 'events' | 'tasks' | 'routines',
  id: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from(table).select('*').eq('id', id).eq('user_id', userId).maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

/** Postgres unique_violation. */
export const UNIQUE_VIOLATION = '23505'
