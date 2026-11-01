import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, isAuthError, validationError } from '@/lib/auth/helpers'
import {
  clearTelegramToken,
  hasTelegramToken,
  isValidTelegramToken,
  setTelegramToken,
} from '@/lib/notifications/telegram-token'

const putSchema = z.object({
  token: z.string().refine(isValidTelegramToken, { message: 'That does not look like a bot token' }),
})

/**
 * Browser sessions only. Notifications carry booker names and event details, so an
 * API key, which can come from a prompt-injected agent, must not be able to point
 * them at someone else's bot.
 */
function refuseApiKey(request: NextRequest): NextResponse | null {
  if (request.headers.get('authorization')?.startsWith('Bearer pk_')) {
    return NextResponse.json(
      { error: 'The Telegram token can only be changed from the app' },
      { status: 403 },
    )
  }
  return null
}

/** Whether a token is set. Never returns the token. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth
  return NextResponse.json({ configured: await hasTelegramToken(auth.userId) })
}

export async function PUT(request: NextRequest) {
  const refused = refuseApiKey(request)
  if (refused) return refused

  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return validationError(parsed.error.issues)

  await setTelegramToken(auth.userId, parsed.data.token)
  return NextResponse.json({ configured: true })
}

export async function DELETE(request: NextRequest) {
  const refused = refuseApiKey(request)
  if (refused) return refused

  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  await clearTelegramToken(auth.userId)
  return NextResponse.json({ configured: false })
}
