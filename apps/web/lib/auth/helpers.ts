import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../supabase/server'
import { authenticateApiKey } from './api-key'
import { createUserScopedClient } from './user-jwt'
import { getApiKeyAccessToken } from './api-key-session'
import { rateLimitAsync } from '../rate-limit'

export interface AuthResult {
  userId: string
  supabase: Awaited<ReturnType<typeof createClient>>
}

// ---------------------------------------------------------------------------
// Rate limits for the authenticated API-key surface (spec #78). Session
// (browser) callers are unlimited. Requests are classified by HTTP method.
// ---------------------------------------------------------------------------
const READ_LIMIT_PER_MIN = 1000
const WRITE_LIMIT_PER_MIN = 100
const RATE_WINDOW_MS = 60_000

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

export async function authenticate(
  request: NextRequest
): Promise<AuthResult | NextResponse> {
  // 1. API-key auth. The key is verified (SHA-256 + timingSafeEqual against
  //    api_keys). The request then runs under RLS *as the key's user* with a real
  //    Auth session held for that key, never the service role.
  const apiKey = await authenticateApiKey(request)
  if (apiKey) {
    const limited = await enforceApiKeyRateLimit(request, apiKey.keyId)
    if (limited) return limited

    let accessToken: string
    try {
      accessToken = await getApiKeyAccessToken(apiKey.keyId, apiKey.userId)
    } catch (err) {
      console.warn('[auth] API key rejected: no session', { keyId: apiKey.keyId, err })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const supabase = createUserScopedClient(accessToken) as AuthResult['supabase']
    return { userId: apiKey.userId, supabase }
  }

  // 2. Session auth (browser). RLS-respecting SSR client, unlimited.
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return { userId: user.id, supabase }
}

/**
 * Enforce the per-key request budget. Returns a 429 (with Retry-After) when the
 * key is over its limit, or null when the request may proceed.
 */
async function enforceApiKeyRateLimit(
  request: NextRequest,
  keyId: string
): Promise<NextResponse | null> {
  const isRead = isReadMethod(request.method)
  const limit = isRead ? READ_LIMIT_PER_MIN : WRITE_LIMIT_PER_MIN
  const bucket = isRead ? 'read' : 'write'

  const allowed = await rateLimitAsync(`apikey:${bucket}:${keyId}`, limit, RATE_WINDOW_MS)
  if (allowed) return null

  const retryAfterSeconds = Math.ceil(RATE_WINDOW_MS / 1000)
  return NextResponse.json(
    { error: 'Rate limit exceeded', limit, window: '1m' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}

export function isAuthError(result: AuthResult | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}

/**
 * Zod validation failure response. Spec #77: schema validation errors return
 * 422 (Unprocessable Entity), distinct from a genuinely malformed request body
 * (unparseable JSON), which the routes still return as 400.
 */
export function validationError(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const details: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_root'
    if (!details[key]) details[key] = []
    details[key].push(issue.message)
  }
  return NextResponse.json(
    { error: 'Validation error', details },
    { status: 422 }
  )
}
