import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '../env'
import { decryptToken, encryptToken } from '../crypto'

// ---------------------------------------------------------------------------
// API key -> a real Auth session for the key's user.
//
// Requests made with an API key must run under RLS as that user, so they need a
// token Supabase accepts. Signing one ourselves requires the project's legacy JWT
// secret, which a new project may not have. Instead the service role asks Auth to
// issue a one-time link for the user, and we exchange it straight away, so Auth
// signs the session with whatever keys the project uses. No email is sent.
//
// Sessions are stored encrypted per key and refreshed like any other session.
// Minting counts against Auth's verification rate limit, so it should be rare:
// memory first, then the stored session, then a refresh, and only then a new one.
// ---------------------------------------------------------------------------

/** Treat a token this close to expiry as already expired. */
const EXPIRY_MARGIN_MS = 60_000

interface CachedToken {
  accessToken: string
  expiresAtMs: number
}

const memoryCache = new Map<string, CachedToken>()

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }

function adminClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    authOptions,
  )
}

function publicClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    authOptions,
  )
}

interface AuthSession {
  access_token: string
  refresh_token: string
  expires_at?: number
}

function isUsable(expiresAtMs: number): boolean {
  return expiresAtMs - Date.now() > EXPIRY_MARGIN_MS
}

/** Create a new session for the user. Throws if Auth refuses, such as for a banned user. */
async function mintSession(userId: string): Promise<AuthSession> {
  const admin = adminClient()

  const { data: found, error: userError } = await admin.auth.admin.getUserById(userId)
  const email = found?.user?.email
  if (userError || !email) {
    throw new Error('API key owner could not be found')
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    throw new Error('Auth refused to create a session for this API key')
  }

  const { data: verified, error: verifyError } = await publicClient().auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })
  if (verifyError || !verified.session) {
    throw new Error('Auth refused to create a session for this API key')
  }
  return verified.session
}

async function refreshSession(refreshToken: string): Promise<AuthSession | null> {
  const { data, error } = await publicClient().auth.refreshSession({
    refresh_token: refreshToken,
  })
  return error || !data.session ? null : data.session
}

async function storeSession(keyId: string, session: AuthSession): Promise<CachedToken> {
  const expiresAtMs = (session.expires_at ?? 0) * 1000
  const { error } = await adminClient()
    .from('api_key_sessions')
    .upsert({
      key_id: keyId,
      access_token: encryptToken(session.access_token),
      refresh_token: encryptToken(session.refresh_token),
      expires_at: new Date(expiresAtMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
  if (error) {
    // Still usable for this instance; the next cold start mints a new one.
    console.error('[auth] Failed to store API key session:', error.message)
  }
  const cached = { accessToken: session.access_token, expiresAtMs }
  memoryCache.set(keyId, cached)
  return cached
}

/** An access token that runs as the key's user. */
export async function getApiKeyAccessToken(keyId: string, userId: string): Promise<string> {
  const inMemory = memoryCache.get(keyId)
  if (inMemory && isUsable(inMemory.expiresAtMs)) {
    return inMemory.accessToken
  }

  const { data: stored } = await adminClient()
    .from('api_key_sessions')
    .select('access_token, refresh_token, expires_at')
    .eq('key_id', keyId)
    .maybeSingle()

  if (stored) {
    try {
      const expiresAtMs = new Date(stored.expires_at).getTime()
      if (isUsable(expiresAtMs)) {
        const accessToken = decryptToken(stored.access_token)
        memoryCache.set(keyId, { accessToken, expiresAtMs })
        return accessToken
      }
      const refreshed = await refreshSession(decryptToken(stored.refresh_token))
      if (refreshed) {
        return (await storeSession(keyId, refreshed)).accessToken
      }
    } catch (err) {
      // A rotated encryption key lands here. A new session fixes it.
      console.warn('[auth] Stored API key session was unusable:', err)
    }
  }

  return (await storeSession(keyId, await mintSession(userId))).accessToken
}

/** Test seam: forget cached tokens. */
export function clearApiKeySessionCache(): void {
  memoryCache.clear()
}
