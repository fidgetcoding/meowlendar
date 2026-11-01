import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '../env'
import { decryptToken, encryptToken } from '../crypto'

// Telegram bot tokens are held in user_secrets, encrypted, and only the server can
// read them. The browser only ever learns whether one is set.

const TOKEN_SHAPE = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/

export function isValidTelegramToken(token: string): boolean {
  return TOKEN_SHAPE.test(token)
}

function serviceClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function setTelegramToken(userId: string, token: string): Promise<void> {
  const { error } = await serviceClient().from('user_secrets').upsert({
    user_id: userId,
    telegram_bot_token: encryptToken(token),
    telegram_bot_token_legacy: null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error('Failed to save the Telegram token')
}

export async function clearTelegramToken(userId: string): Promise<void> {
  const { error } = await serviceClient().from('user_secrets').upsert({
    user_id: userId,
    telegram_bot_token: null,
    telegram_bot_token_legacy: null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error('Failed to remove the Telegram token')
}

export async function hasTelegramToken(userId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from('user_secrets')
    .select('telegram_bot_token, telegram_bot_token_legacy')
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(data?.telegram_bot_token || data?.telegram_bot_token_legacy)
}

/** The decrypted token, or null when none is set. Encrypts a migrated token on first use. */
export async function getTelegramToken(userId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('user_secrets')
    .select('telegram_bot_token, telegram_bot_token_legacy')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return null

  if (data.telegram_bot_token) return decryptToken(data.telegram_bot_token)

  if (data.telegram_bot_token_legacy) {
    const token = data.telegram_bot_token_legacy as string
    await setTelegramToken(userId, token)
    return token
  }
  return null
}
