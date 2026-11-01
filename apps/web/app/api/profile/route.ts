import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../lib/auth/helpers'
import { z } from 'zod'

const updateProfileSchema = z.object({
  display_name: z.string().max(200).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).refine(
    (obj) => JSON.stringify(obj).length <= 10_000,
    { message: 'Settings payload must be under 10KB' }
  ).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Strip sensitive credentials from the settings object before returning.
  // Telegram bot tokens are stored in settings but must never be exposed
  // to the client -- the client only needs to know whether they are configured.
  if (profile.settings && typeof profile.settings === 'object') {
    const safeSettings = { ...(profile.settings as Record<string, unknown>) }
    const hasTelegramToken = Boolean(safeSettings.telegram_bot_token)
    const hasTelegramChat = Boolean(safeSettings.telegram_chat_id)
    delete safeSettings.telegram_bot_token
    delete safeSettings.telegram_chat_id
    safeSettings.telegram_configured = hasTelegramToken && hasTelegramChat
    return NextResponse.json({ ...profile, settings: safeSettings })
  }

  return NextResponse.json(profile)
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = {}

  if (parsed.data.display_name !== undefined) updates.display_name = parsed.data.display_name
  if (parsed.data.company !== undefined) updates.company = parsed.data.company
  if (parsed.data.avatar_url !== undefined) updates.avatar_url = parsed.data.avatar_url

  if (parsed.data.settings) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .single()

    updates.settings = { ...(existing?.settings ?? {}), ...parsed.data.settings }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  const safeProfile = { ...profile }
  if (safeProfile.settings && typeof safeProfile.settings === 'object') {
    const s = { ...(safeProfile.settings as Record<string, unknown>) }
    const hasTelegramToken = Boolean(s.telegram_bot_token)
    const hasTelegramChat = Boolean(s.telegram_chat_id)
    delete s.telegram_bot_token
    delete s.telegram_chat_id
    s.telegram_configured = hasTelegramToken && hasTelegramChat
    safeProfile.settings = s
  }
  return NextResponse.json(safeProfile)
}
