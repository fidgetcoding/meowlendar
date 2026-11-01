import { createServerClient } from '@supabase/ssr'
import { requireEnv } from '../env'

/**
 * Build a Supabase client that talks to PostgREST as the user a token belongs to.
 * Uses the public key plus an Authorization bearer so RLS applies natively. No
 * cookies, no session: this client is per-request and never persists auth state.
 */
export function createUserScopedClient(accessToken: string) {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      cookies: { getAll() { return [] }, setAll() {} },
    },
  )
}
