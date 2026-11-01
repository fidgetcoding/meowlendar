// SERVICE ROLE: Required. Runs with no user, and needs cross-user access to find
// stale accounts and to push waiting changes for every user.
import { createServerClient } from '@supabase/ssr'
import { flushEventTombstones, pullChanges, retryPendingPushEvents } from '@/lib/google/sync'
import { flushTaskSync } from '@/lib/google/task-sync'
import { registerAccountWebhook } from '@/lib/google/webhooks'
import { pruneRateLimitEntries } from '@/lib/rate-limit'
import { requireEnv } from '@/lib/env'

function getServiceClient() {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

/** Accounts not synced within this window are considered stale. */
const STALE_THRESHOLD_MINUTES = 4

/** Channels live 7 days; renew once less than this remains. */
const RENEWAL_WINDOW_MS = 24 * 60 * 60_000

/** Pulls accounts that have gone quiet and pushes changes waiting to go out. */
export async function runSyncPoll() {
  const supabase = getServiceClient()
  let processed = 0
  const errors: string[] = []

  const staleThreshold = new Date(
    Date.now() - STALE_THRESHOLD_MINUTES * 60_000
  ).toISOString()

  // Webhook fallback: accounts whose webhook hasn't fired recently (or that were
  // just connected and haven't synced yet).
  const { data: staleAccounts, error: queryError } = await supabase
    .from('google_accounts')
    .select('id, last_synced_at')
    .or(`last_synced_at.is.null,last_synced_at.lt.${staleThreshold}`)

  if (queryError) {
    throw new Error(`Failed to query accounts: ${queryError.message}`)
  }

  for (const account of staleAccounts ?? []) {
    try {
      await pullChanges(account.id)
      processed++
    } catch (err) {
      const msg = `Account ${account.id}: ${err instanceof Error ? err.message : 'unknown error'}`
      errors.push(msg)
      console.error('Sync poll failed:', msg)
    }
  }

  // Changes made here that still have to reach Google.
  const retry = await retryPendingPushEvents()
  const tasks = await flushTaskSync()
  const deletes = await flushEventTombstones()

  await pruneRateLimitEntries()

  return {
    success: true,
    processed,
    retry,
    tasks,
    deletes,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

/** Renews Google push channels before their 7-day lifetime ends. */
export async function runWebhookRenewal() {
  const supabase = getServiceClient()
  let processed = 0
  const errors: string[] = []

  const { data: accounts, error: accountsError } = await supabase
    .from('google_accounts')
    .select('id, webhook_channel_id, webhook_channel_expiration')

  if (accountsError) {
    throw new Error(`Failed to fetch accounts: ${accountsError.message}`)
  }

  const now = Date.now()

  for (const account of accounts ?? []) {
    // Renew when no channel exists, or when it's within the renewal window.
    const expiration = account.webhook_channel_expiration
      ? new Date(account.webhook_channel_expiration).getTime()
      : null
    const needsRenewal =
      !account.webhook_channel_id ||
      expiration === null ||
      expiration - now < RENEWAL_WINDOW_MS

    if (!needsRenewal) continue

    try {
      const registered = await registerAccountWebhook(account.id)
      if (registered) processed++
    } catch (err) {
      const msg = `Account ${account.id}: ${err instanceof Error ? err.message : 'unknown error'}`
      errors.push(msg)
      console.error('Webhook renewal failed:', msg)
    }
  }

  return {
    success: true,
    processed,
    ...(errors.length > 0 ? { errors } : {}),
  }
}
