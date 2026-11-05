import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Waits until the browser client holds the new session, so the first requests after sign-in go
 * out signed in. A request sent a moment too early is answered by row-level security with no
 * rows, which the week then showed as empty until a reload.
 */
export async function waitForSession(
  supabase: Pick<SupabaseClient, 'auth'>,
  { timeoutMs = 3000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * The signed-in user's id, from the session the browser already holds. Unlike getUser() this
 * asks no server, so a create never waits on a round trip that a reload would abort. Row-level
 * security still checks the id against the session's token.
 */
export async function sessionUserId(supabase: Pick<SupabaseClient, 'auth'>): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const id = data.session?.user.id
  if (!id) throw new Error('Not authenticated')
  return id
}
