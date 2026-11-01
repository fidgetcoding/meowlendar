import { createClient } from '@supabase/supabase-js'
import { runReminders } from './reminders'
import { runSyncPoll, runWebhookRenewal } from './sync-job'

// Runs the background jobs inside the app process, so a plain `next start` or
// `pnpm dev` keeps itself in sync with nothing else to set up. Vercel has no
// long-running process, so it uses the crons in vercel.json instead.

const DEFAULT_SYNC_SECONDS = 300
const REMINDER_SECONDS = 60
const RENEWAL_SECONDS = 6 * 60 * 60

// Dev reloads and Next's workers can load this more than once.
const state = globalThis as typeof globalThis & { __meowSchedulerStarted?: boolean }

async function withLease(name: string, seconds: number, job: () => Promise<unknown>) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  try {
    // A lease shorter than the interval, so a crashed holder blocks only one round.
    const { data: held, error } = await supabase.rpc('try_scheduler_lease', {
      p_name: name,
      p_seconds: Math.max(seconds - 1, 1),
    })
    if (error) throw error
    if (!held) return
    await job()
  } catch (err) {
    console.error(`[scheduler] ${name} failed:`, err)
  }
}

function every(name: string, seconds: number, job: () => Promise<unknown>) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await withLease(name, seconds, job)
    } finally {
      running = false
    }
  }
  setInterval(tick, seconds * 1000).unref()
  // A first run shortly after boot, so restarting doesn't delay a whole interval.
  setTimeout(tick, Math.min(seconds, 5) * 1000).unref()
}

/** The sync interval in seconds, or null when the scheduler should stay off. */
export function schedulerInterval(env: NodeJS.ProcessEnv = process.env): number | null {
  if (env.VERCEL) return null
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  const raw = env.SCHEDULER_INTERVAL_SECONDS
  if (raw === undefined || raw.trim() === '') return DEFAULT_SYNC_SECONDS
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds
}

export function startScheduler(): void {
  if (state.__meowSchedulerStarted) return
  const seconds = schedulerInterval()
  if (seconds === null) return
  state.__meowSchedulerStarted = true

  console.log(`[scheduler] syncing every ${seconds}s`)
  every('sync-poll', seconds, runSyncPoll)
  every('reminders', Math.min(seconds, REMINDER_SECONDS), runReminders)
  every('webhook-renewal', RENEWAL_SECONDS, runWebhookRenewal)
}
