// SERVICE ROLE: Not needed — authenticated endpoint. Uses the session user's
// client (RLS-scoped) so each user can only manage their own push_subscriptions.
// API-key callers get the same RLS scoping through the key's own Auth session.
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../../lib/auth/helpers'
import { z } from 'zod'

// The server POSTs to this address on the user's behalf, so it can't be just any URL
// or a user could aim the server at something on its own network.
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]

function isPushServiceEndpoint(endpoint: string): boolean {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  const extra = (process.env.PUSH_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase())
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    host.endsWith('.notify.windows.com') ||
    host.endsWith('.push.apple.com') ||
    host.endsWith('.push.services.mozilla.com') ||
    extra.includes(host)
  )
}

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000).refine(isPushServiceEndpoint, {
    message: 'Not a known push service',
  }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { endpoint, keys } = parsed.data

  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint,
        keys,
      },
      { onConflict: 'user_id,endpoint' }
    )
    .select()
    .single()

  if (error) {
    console.error('[api/notifications/subscribe] Upsert failed:', error)
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = unsubscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', parsed.data.endpoint)

  if (error) {
    console.error('[api/notifications/subscribe] Delete failed:', error)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
