import { createServerClient } from '@supabase/ssr'
import { requireEnv } from '../env'
import { encryptToken, decryptToken } from '../crypto'
import { getGoogleAccessToken } from './calendar'
import type { GoogleCalendarListEntry } from './types'
import { googleApiBase, googleAuthUrl, googleRevokeUrl, googleTokenUrl } from '../external-urls'

function getServiceClient() {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      cookies: {
        getAll() { return [] },
        setAll() {},
      },
    }
  )
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

/**
 * Generate Google OAuth consent URL.
 * State param must be a pre-signed CSRF-safe string (userId.nonce.hmac).
 */
export function getGoogleOAuthUrl(
  signedState: string,
  redirectUri: string
): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    // select_account: without it Google reuses the signed-in session, so a
    // second "Connect" can't reach a different account.
    prompt: 'select_account consent',
    state: signedState,
  })

  return `${googleAuthUrl()}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens, then fetch the user's email
 * from Google's userinfo endpoint.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
  email: string
}> {
  const tokenResponse = await fetch(googleTokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text()
    throw new Error(
      `Google token exchange failed: ${tokenResponse.status} ${body}`
    )
  }

  const tokenData = await tokenResponse.json()

  // Google omits refresh_token on re-consent when the user has already granted
  // offline access. We don't throw here — saveGoogleAccount preserves the token
  // already on file. (We still request access_type=offline + prompt=consent to
  // maximise the odds of getting one on the first connect.)

  // Fetch the Google account email
  const userinfoResponse = await fetch(
    `${googleApiBase()}/oauth2/v2/userinfo`,
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }
  )

  if (!userinfoResponse.ok) {
    throw new Error('Failed to fetch Google user info')
  }

  const userinfo = await userinfoResponse.json()

  return {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_in: tokenData.expires_in,
    email: userinfo.email,
  }
}

// Google Calendar API color ID to hex mapping
const GOOGLE_CALENDAR_COLORS: Record<string, string> = {
  '1': '#795548',
  '2': '#33B679',
  '3': '#8E24AA',
  '4': '#E67C73',
  '5': '#F6BF26',
  '6': '#F4511E',
  '7': '#039BE5',
  '8': '#616161',
  '9': '#3F51B5',
  '10': '#0B8043',
  '11': '#D50000',
  '12': '#F09300',
  '13': '#009688',
  '14': '#4285F4',
  '15': '#9E69AF',
  '16': '#AD1457',
  '17': '#D81B60',
  '18': '#795548',
  '19': '#A79B8E',
  '20': '#33B679',
  '21': '#E4C441',
  '22': '#0B8043',
  '23': '#3F51B5',
  '24': '#8E24AA',
}

/**
 * Upsert a Google account and its calendars into the database.
 * Returns the google_account_id.
 */
export async function saveGoogleAccount(
  userId: string,
  tokens: {
    access_token: string
    refresh_token?: string
    expires_in: number
    email: string
  }
): Promise<string> {
  const supabase = getServiceClient()
  const tokenExpiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString()

  // Resolve the refresh_token column. Prefer the freshly-issued token; when
  // Google omitted it (re-consent), preserve the encrypted value already on
  // file rather than overwriting it with null. First connect with no token on
  // either side is unrecoverable — refuse loudly.
  let refreshTokenColumn: string
  if (tokens.refresh_token) {
    refreshTokenColumn = encryptToken(tokens.refresh_token)
  } else {
    const { data: existing } = await supabase
      .from('google_accounts')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('email', tokens.email)
      .maybeSingle()

    if (!existing?.refresh_token) {
      throw new Error(
        'Google returned no refresh_token and none is stored for this account. ' +
          'Re-connect with prompt=consent so a refresh_token is issued.'
      )
    }
    // Keep the existing ciphertext verbatim — it is already encrypted at rest.
    refreshTokenColumn = existing.refresh_token
  }

  // Upsert the google_accounts row
  const { data: account, error: accountError } = await supabase
    .from('google_accounts')
    .upsert(
      {
        user_id: userId,
        email: tokens.email,
        // Tokens are encrypted at the app layer before they touch the DB.
        access_token: encryptToken(tokens.access_token),
        refresh_token: refreshTokenColumn,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: 'user_id,email' }
    )
    .select('id')
    .single()

  if (accountError || !account) {
    throw new Error(
      `Failed to save Google account: ${accountError?.message ?? 'unknown'}`
    )
  }

  const accountId = account.id

  // Account is saved even if this fails: the next sync retries it.
  try {
    await syncCalendarList(accountId, userId)
  } catch (err) {
    console.error('Failed to fetch Google calendar list:', err)
  }

  return accountId
}

/**
 * Brings the calendars table in line with Google's calendar list. New calendars come
 * in turned on. Existing ones keep the user's on/off choice and colour. Calendars
 * gone from Google go here too, with their events.
 */
export async function syncCalendarList(accountId: string, userId: string): Promise<void> {
  const supabase = getServiceClient()
  const accessToken = await getGoogleAccessToken(accountId)

  const response = await fetch(`${googleApiBase()}/calendar/v3/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Google calendar list failed: ${response.status}`)
  }

  const { items } = (await response.json()) as { items?: GoogleCalendarListEntry[] }
  const remote = items ?? []

  const { data: existing } = await supabase
    .from('calendars')
    .select('id, google_calendar_id')
    .eq('google_account_id', accountId)
  const known = new Map((existing ?? []).map((c) => [c.google_calendar_id as string, c.id as string]))

  for (const cal of remote) {
    const shared = {
      name: cal.summary ?? cal.id,
      is_primary: cal.primary === true,
      access_role: cal.accessRole ?? null,
    }
    const localId = known.get(cal.id)
    if (localId) {
      await supabase.from('calendars').update(shared).eq('id', localId)
    } else {
      await supabase.from('calendars').insert({
        ...shared,
        user_id: userId,
        source: 'google',
        google_account_id: accountId,
        google_calendar_id: cal.id,
        color: cal.backgroundColor ?? GOOGLE_CALENDAR_COLORS[cal.id] ?? '#4285F4',
        is_active: true,
      })
    }
  }

  const remoteIds = new Set(remote.map((c) => c.id))
  const gone = (existing ?? []).filter((c) => !remoteIds.has(c.google_calendar_id as string))
  for (const cal of gone) {
    await supabase.from('calendars').delete().eq('id', cal.id)
  }
}

/**
 * Disconnect a Google account: revoke the token (best-effort),
 * then delete the google_accounts row (cascades to calendars + events).
 */
export async function disconnectGoogleAccount(
  accountId: string
): Promise<void> {
  const supabase = getServiceClient()

  // Fetch the token so we can revoke it
  const { data: account } = await supabase
    .from('google_accounts')
    .select('access_token, refresh_token')
    .eq('id', accountId)
    .single()

  // Best-effort token revocation — don't throw if it fails
  const storedToken = account?.refresh_token ?? account?.access_token
  if (storedToken) {
    try {
      const tokenToRevoke = decryptToken(storedToken)
      await fetch(
        `${googleRevokeUrl()}?token=${encodeURIComponent(tokenToRevoke)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )
    } catch {
      // Revocation failure is non-fatal — the token expires on its own
    }
  }

  // Delete cascades to calendars and events via FK constraints
  const { error } = await supabase
    .from('google_accounts')
    .delete()
    .eq('id', accountId)

  if (error) {
    throw new Error(`Failed to disconnect Google account: ${error.message}`)
  }
}
