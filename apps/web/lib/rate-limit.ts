import { createServerClient } from '@supabase/ssr'
import { requireEnv } from './env'

// ---------------------------------------------------------------------------
// In-memory fallback — defence-in-depth for when Supabase is unreachable.
// Resets on cold-start but prevents runaway abuse within a single instance.
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

// ---------------------------------------------------------------------------
// Supabase-backed sliding window counter.
// Uses the `rate_limit_entries` table (migration 006). Expired rows are removed
// by pruneRateLimitEntries, which the sync-poll cron calls.
// ---------------------------------------------------------------------------
function getServiceClient() {
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

/**
 * Serverless-safe rate limiter backed by Supabase.
 *
 * Upserts a sliding-window counter in `rate_limit_entries`. If the current
 * window has elapsed the counter resets to 1. Returns `true` when the request
 * is allowed, `false` when the limit is exceeded.
 *
 * Falls back to in-memory counting when the Supabase call fails so that a
 * transient DB outage does not leave the endpoint completely unprotected.
 */
export async function rateLimitAsync(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const supabase = getServiceClient()
    const now = new Date()
    const windowStart = new Date(now.getTime() - windowMs)

    // Atomic upsert: reset expired windows, increment active ones.
    // Uses RPC to avoid TOCTOU race between read and write.
    const { data, error } = await supabase.rpc('rate_limit_check', {
      p_key: key,
      p_limit: limit,
      p_window_start: windowStart.toISOString(),
      p_now: now.toISOString(),
    })

    if (error) throw error
    return data as boolean
  } catch (err) {
    // Supabase unreachable — fall back to in-memory so the endpoint is not
    // completely unprotected during transient outages.
    console.warn('[rate-limit] Supabase call failed, falling back to in-memory', err)
    return rateLimit(key, limit, windowMs)
  }
}

/** Longest window any caller uses is an hour, so a day-old row is dead. */
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000

/** Delete expired counters. Called from the sync-poll cron; never throws. */
export async function pruneRateLimitEntries(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RATE_LIMIT_RETENTION_MS).toISOString()
    const { error } = await getServiceClient()
      .from('rate_limit_entries')
      .delete()
      .lt('window_start', cutoff)
    if (error) throw error
  } catch (err) {
    console.warn('[rate-limit] Failed to prune old entries', err)
  }
}

// ---------------------------------------------------------------------------
// Headers helper — derives values from the in-memory map (best-effort;
// accurate within a single instance). Not currently used in routes but
// preserved for future use.
// ---------------------------------------------------------------------------
export function getRateLimitHeaders(key: string, limit: number, windowMs: number) {
  const entry = rateLimitMap.get(key)
  const remaining = entry ? Math.max(0, limit - entry.count) : limit
  const reset = entry ? Math.ceil((entry.resetTime - Date.now()) / 1000) : Math.ceil(windowMs / 1000)
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(reset),
  }
}
