// SERVICE ROLE: Not needed — authenticated endpoint. Uses the session user's
// client (RLS-scoped) so dispatching is scoped to the current user's
// subscriptions. API-key callers get the same RLS scoping through a short-lived
// user JWT minted in authenticate().
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../../lib/auth/helpers'
import { z } from 'zod'
import { dispatchToChannel } from '../../../../lib/notifications/dispatcher'
import type { NotificationPayload } from '../../../../lib/notifications/types'

const testSchema = z.object({
  channel: z.enum(['browser_push', 'email', 'in_app', 'telegram']),
})

const TEST_PAYLOAD: NotificationPayload = {
  title: 'Test Notification',
  body: 'This is a test notification from Meowlendar. If you see this, your notification channel is working.',
  event: 'reminder',
  url: '/',
}

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

  const parsed = testSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const result = await dispatchToChannel(
    supabase,
    userId,
    parsed.data.channel,
    TEST_PAYLOAD
  )

  if (!result.success) {
    return NextResponse.json(
      { error: result.error ?? 'Failed to send test notification' },
      { status: 422 }
    )
  }

  return NextResponse.json({ ok: true, channel: result.channel })
}
