import { createServerClient } from '@supabase/ssr'
import { requireEnv } from '../env'
import { encryptToken, decryptToken } from '../crypto'
import type { GoogleEvent, GoogleEventInsert, GoogleEventWrite, GoogleEventsPage } from './types'

interface GoogleTokens {
  access_token: string
  refresh_token: string
  token_expires_at: string
}

async function getServiceClient() {
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

async function refreshTokenIfNeeded(
  accountId: string,
  tokens: GoogleTokens
): Promise<string> {
  const expiresAt = new Date(tokens.token_expires_at)
  const now = new Date()

  // Tokens are stored encrypted at rest — decrypt before use.
  const accessToken = decryptToken(tokens.access_token)

  if (expiresAt.getTime() - now.getTime() > 60000) {
    return accessToken
  }

  const refreshToken = decryptToken(tokens.refresh_token)

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to refresh Google token')
  }

  const data = await response.json()
  const supabase = await getServiceClient()

  await supabase
    .from('google_accounts')
    .update({
      // Re-encrypt the freshly issued access token before persisting.
      access_token: encryptToken(data.access_token),
      token_expires_at: new Date(
        Date.now() + data.expires_in * 1000
      ).toISOString(),
    })
    .eq('id', accountId)

  return data.access_token
}

export async function getGoogleAccessToken(accountId: string): Promise<string> {
  const supabase = await getServiceClient()
  const { data, error } = await supabase
    .from('google_accounts')
    .select('access_token, refresh_token, token_expires_at')
    .eq('id', accountId)
    .single()

  if (error || !data) {
    throw new Error('Google account not found')
  }

  return refreshTokenIfNeeded(accountId, data)
}

export async function googleCalendarRequest(
  accessToken: string,
  path: string,
  options: RequestInit = {}
) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }
  )

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Google Calendar API error: ${response.status} ${errorBody}`)
  }

  if (response.status === 204) return null
  return response.json()
}

export async function createGoogleEvent(
  accountId: string,
  calendarId: string,
  event: GoogleEventInsert,
  conferencing = false
): Promise<GoogleEvent> {
  const accessToken = await getGoogleAccessToken(accountId)
  const params = conferencing ? '?conferenceDataVersion=1' : ''

  if (conferencing && !event.conferenceData) {
    event.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }

  return googleCalendarRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events${params}`,
    {
      method: 'POST',
      body: JSON.stringify(event),
    }
  )
}

export async function updateGoogleEvent(
  accountId: string,
  calendarId: string,
  googleEventId: string,
  event: GoogleEventWrite
): Promise<GoogleEvent> {
  const accessToken = await getGoogleAccessToken(accountId)
  return googleCalendarRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(event),
    }
  )
}

export async function deleteGoogleEvent(
  accountId: string,
  calendarId: string,
  googleEventId: string
) {
  const accessToken = await getGoogleAccessToken(accountId)
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar delete failed: ${response.status}`)
  }
}

export async function listGoogleEvents(
  accountId: string,
  calendarId: string,
  options: {
    timeMin?: string
    timeMax?: string
    syncToken?: string
    pageToken?: string
  }
): Promise<GoogleEventsPage> {
  const accessToken = await getGoogleAccessToken(accountId)
  const params = new URLSearchParams()
  if (options.timeMin) params.set('timeMin', options.timeMin)
  if (options.timeMax) params.set('timeMax', options.timeMax)
  if (options.syncToken) params.set('syncToken', options.syncToken)
  if (options.pageToken) params.set('pageToken', options.pageToken)
  params.set('singleEvents', 'false')
  params.set('maxResults', '250')

  return googleCalendarRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
  )
}

export async function watchGoogleCalendar(
  accountId: string,
  calendarId: string,
  webhookUrl: string
) {
  const accessToken = await getGoogleAccessToken(accountId)
  const channelId = crypto.randomUUID()

  const body: Record<string, unknown> = {
    id: channelId,
    type: 'web_hook',
    address: webhookUrl,
    params: { ttl: '604800' }, // 7 days
  }

  // Google echoes `token` back on every notification as x-goog-channel-token.
  // The webhook route validates it against GOOGLE_WEBHOOK_SECRET, so a channel
  // registered without the secret would never pass validation — set it here.
  const secret = process.env.GOOGLE_WEBHOOK_SECRET
  if (secret && secret.trim() && secret.trim().toLowerCase() !== 'placeholder') {
    body.token = secret
  }

  return googleCalendarRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  )
}

/**
 * Push a calendar's colour to Google via calendarList.update. Uses
 * colorRgbFormat=true so an arbitrary hex background can be set (rather than one
 * of Google's fixed palette IDs). Callers swallow failures (spec #49a) — the
 * local colour is authoritative for rendering.
 */
export async function updateGoogleCalendarColor(
  accountId: string,
  googleCalendarId: string,
  hexColor: string
) {
  const accessToken = await getGoogleAccessToken(accountId)
  return googleCalendarRequest(
    accessToken,
    `/users/me/calendarList/${encodeURIComponent(googleCalendarId)}?colorRgbFormat=true`,
    {
      method: 'PATCH',
      body: JSON.stringify({ backgroundColor: hexColor }),
    }
  )
}
