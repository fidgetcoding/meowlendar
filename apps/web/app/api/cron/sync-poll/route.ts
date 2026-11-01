// SERVICE ROLE: Required — triggered by n8n (not an authenticated user) with a
// CRON_SECRET bearer. Needs cross-user access to find stale accounts and to
// re-push stranded events for every user.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { pullChanges, retryPendingPushEvents } from '@/lib/google/sync'
import { verifyCronSecret } from '@/lib/auth/cron'
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
const STALE_THRESHOLD_MINUTES = 10

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getServiceClient()
    let processed = 0
    const errors: string[] = []

    const staleThreshold = new Date(
      Date.now() - STALE_THRESHOLD_MINUTES * 60_000
    ).toISOString()

    // Webhook fallback: accounts whose webhook hasn't fired recently (or that
    // were just connected and haven't synced yet).
    const { data: staleAccounts, error: queryError } = await supabase
      .from('google_accounts')
      .select('id, last_synced_at')
      .or(`last_synced_at.is.null,last_synced_at.lt.${staleThreshold}`)

    if (queryError) {
      return NextResponse.json(
        { error: `Failed to query accounts: ${queryError.message}` },
        { status: 500 }
      )
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

    // Re-push events stranded in pending_push (events/route.ts leaves them
    // there on inline Google-write failure; nothing else retries them).
    const retry = await retryPendingPushEvents()

    await pruneRateLimitEntries()

    return NextResponse.json({
      success: true,
      processed,
      retry,
      ...(errors.length > 0 ? { errors } : {}),
    })
  } catch (error) {
    console.error('Cron sync-poll error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}
