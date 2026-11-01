import { createServerClient } from '@supabase/ssr'
import { requireEnv, optionalEnv } from '../env'
import { getGoogleAccessToken, watchGoogleCalendar } from './calendar'
import { googleApiBase } from '../external-urls'

// ---------------------------------------------------------------------------
// Google Calendar push-webhook registration.
//
// Watches the account's primary (or first active) calendar and records the
// channel id + expiration on google_accounts. Google fires a notification on
// any change to that calendar; the webhook route then pulls incremental changes
// for the whole account. Registration and renewal both funnel through here.
// ---------------------------------------------------------------------------

function getServiceClient() {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {},
      },
    }
  )
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000

/**
 * Register (or re-register) the push webhook for a Google account. Stops any
 * existing channel first (best-effort). No-op — returns false — when webhooks
 * aren't configured (GOOGLE_WEBHOOK_SECRET / NEXT_PUBLIC_APP_URL unset) or the
 * account has no active calendar. The poll cron covers accounts without a live
 * channel, so callers treat a false/throw as non-fatal.
 */
export async function registerAccountWebhook(accountId: string): Promise<boolean> {
  // A channel registered without the shared secret could never pass the
  // webhook route's token check, so skip registration entirely without one.
  if (!optionalEnv('GOOGLE_WEBHOOK_SECRET')) return false

  // Google only delivers to public HTTPS. The scheduled sync covers everything else.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl || !appUrl.trim().startsWith('https://')) return false
  const webhookUrl = `${appUrl}/api/google/webhook`

  const supabase = getServiceClient()

  const { data: account } = await supabase
    .from('google_accounts')
    .select('id, webhook_channel_id, webhook_resource_id')
    .eq('id', accountId)
    .single()

  if (!account) return false

  const { data: calendars } = await supabase
    .from('calendars')
    .select('google_calendar_id, is_primary')
    .eq('google_account_id', accountId)
    .eq('is_active', true)

  if (!calendars || calendars.length === 0) return false

  const primary = calendars.find((c) => c.is_primary) ?? calendars[0]!

  // Stop the previous channel so it doesn't keep firing (best-effort).
  if (account.webhook_channel_id) {
    try {
      const accessToken = await getGoogleAccessToken(accountId)
      await fetch(`${googleApiBase()}/calendar/v3/channels/stop`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: account.webhook_channel_id,
          resourceId: account.webhook_resource_id,
        }),
      })
    } catch {
      // Old channel expires on its own — non-fatal.
    }
  }

  const watchResult = await watchGoogleCalendar(
    accountId,
    primary.google_calendar_id,
    webhookUrl
  )

  const expirationMs = watchResult?.expiration
    ? parseInt(watchResult.expiration, 10)
    : Date.now() + SEVEN_DAYS_MS

  await supabase
    .from('google_accounts')
    .update({
      webhook_channel_id: watchResult?.id ?? null,
      webhook_resource_id: watchResult?.resourceId ?? null,
      webhook_channel_expiration: new Date(expirationMs).toISOString(),
    })
    .eq('id', accountId)

  return true
}
