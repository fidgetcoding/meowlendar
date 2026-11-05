import {
  isAuthApiError,
  isAuthSessionMissingError,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'

export type SessionCheck =
  | { kind: 'signed-in'; user: User }
  | { kind: 'signed-out' }
  | { kind: 'unreachable' }

type GetUserResult = { data: { user: User | null }; error: unknown }

/**
 * Reads getUser()'s answer. Only a definite "no session" signs anyone out: none stored, or the
 * auth server rejecting the one we sent. A network failure, a timeout or a server error says
 * nothing about the session, so the user stays and the check runs again.
 */
export function classifySessionCheck(result: GetUserResult | undefined): SessionCheck {
  const user = result?.data?.user
  if (user) return { kind: 'signed-in', user }
  const error = result?.error
  if (!error || isAuthSessionMissingError(error)) return { kind: 'signed-out' }
  if (isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
    return { kind: 'signed-out' }
  }
  return { kind: 'unreachable' }
}

export async function checkSession(auth: Pick<SupabaseClient['auth'], 'getUser'>): Promise<SessionCheck> {
  try {
    return classifySessionCheck((await auth.getUser()) as GetUserResult)
  } catch {
    return { kind: 'unreachable' }
  }
}

/** The wait before the next check while the auth server can't be reached: 1s, 2s, 4s, up to 30s. */
export function sessionRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt)
}
