// SERVICE ROLE: Required — this endpoint is called by Google, not by an
// authenticated user. It matches the inbound channel to a google_account and
// pulls that account's changes, which needs cross-user table access.
import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { pullChanges } from '@/lib/google/sync'
import { rateLimitAsync } from '@/lib/rate-limit'
import { requireEnv } from '@/lib/env'

function getServiceClient() {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

/** The configured webhook shared secret, or null when webhooks are disabled. */
function webhookSecret(): string | null {
  const s = process.env.GOOGLE_WEBHOOK_SECRET
  if (!s || !s.trim() || s.trim().toLowerCase() === 'placeholder') return null
  return s
}

/** Constant-time compare. Hashing first gives both sides the same length. */
function tokenMatches(token: string | null, secret: string): boolean {
  if (!token) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(token), digest(secret))
}

export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id')
  const resourceId = request.headers.get('x-goog-resource-id')
  const resourceState = request.headers.get('x-goog-resource-state')
  const channelToken = request.headers.get('x-goog-channel-token')

  // Google's one-time handshake right after watch() — acknowledge and stop.
  if (resourceState === 'sync') {
    return new NextResponse(null, { status: 200 })
  }

  if (!channelId || !resourceId) {
    return new NextResponse(null, { status: 400 })
  }

  // Validate the shared secret Google echoes back. Without a configured secret
  // we cannot authenticate the caller, so we reject (the poll cron still syncs).
  const secret = webhookSecret()
  if (!secret || !tokenMatches(channelToken, secret)) {
    return new NextResponse(null, { status: 403 })
  }

  // Cap notification storms per channel.
  if (!(await rateLimitAsync(`webhook:${channelId}`, 60, 60_000))) {
    return new NextResponse(null, { status: 429 })
  }

  const supabase = getServiceClient()

  const { data: matched } = await supabase
    .from('google_accounts')
    .select('id')
    .eq('webhook_channel_id', channelId)
    .maybeSingle()

  // No account owns this channel (stale/unknown) — ack and let poll cover it.
  if (!matched) {
    return new NextResponse(null, { status: 200 })
  }

  try {
    await pullChanges(matched.id)
  } catch (err) {
    console.error(`[google/webhook] sync failed for account ${matched.id}:`, err)
  }

  return new NextResponse(null, { status: 200 })
}
