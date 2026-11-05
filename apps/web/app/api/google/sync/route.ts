import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, isAuthError, validationError } from '@/lib/auth/helpers'
import { flushEventTombstones, pullChanges, retryPendingPushEvents } from '@/lib/google/sync'
import { flushTaskSync } from '@/lib/google/task-sync'

const syncSchema = z.object({
  google_account_id: z.string().uuid().optional(),
})

/** An open tab calls this often. This keeps that from reaching Google every time. */
const MIN_PULL_INTERVAL_MS = 60_000

/**
 * Syncs the caller's Google accounts: changes made here go out, and changes on
 * Google come in. With `google_account_id` it syncs that account now (Resync). With
 * no body it covers every account that hasn't synced in the last minute, which is
 * what the app calls while it's open.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const raw = await request.text()
  let body: unknown = {}
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }

  const parsed = syncSchema.safeParse(body)
  if (!parsed.success) return validationError(parsed.error.issues)

  const { google_account_id: requested } = parsed.data

  // Ownership comes from RLS and the user filter, before the service-role sync runs.
  let query = supabase.from('google_accounts').select('id, last_synced_at').eq('user_id', userId)
  if (requested) query = query.eq('id', requested)
  const { data: accounts, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to read accounts' }, { status: 500 })
  }
  if (requested && !accounts?.length) {
    return NextResponse.json({ error: 'Google account not found' }, { status: 404 })
  }

  try {
    await retryPendingPushEvents({ userId })
    await flushTaskSync({ userId })
    await flushEventTombstones({ userId })

    const totals = { created: 0, updated: 0, deleted: 0 }
    for (const account of accounts ?? []) {
      const recent =
        !requested &&
        account.last_synced_at &&
        Date.now() - new Date(account.last_synced_at).getTime() < MIN_PULL_INTERVAL_MS
      if (recent) continue

      const result = await pullChanges(account.id, { waitForLeaseMs: 10_000 })
      if (!result.complete) {
        return NextResponse.json({ error: 'A sync is already running. Try again shortly.' }, { status: 409 })
      }
      totals.created += result.created
      totals.updated += result.updated
      totals.deleted += result.deleted
    }
    return NextResponse.json({ success: true, ...totals })
  } catch (err) {
    console.error('[google/sync] pull failed:', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 502 })
  }
}
