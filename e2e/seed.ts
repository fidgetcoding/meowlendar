import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Programmatic seed for the E2E stack. The e2e user's DB starts empty, but
// several specs need pre-existing rows (an event to preview/drag/convert, a
// kanban card to drag, an item to search). We sign in as the seed user and
// upsert a small, fixed baseline under RLS (auth.uid() = user_id).
//
// All rows use fixed UUIDs so seeding is idempotent AND resets any mutation a
// prior run left behind (a dragged card returns to Backlog, a moved event
// returns to 10:00). Google tokens are throwaway strings — they are never used
// unless a real sync runs, and inserts don't validate their shape.
// ---------------------------------------------------------------------------

const EMAIL = process.env.E2E_EMAIL || 'e2e@poolendar.test'
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-test-password-1'

// Fixed identifiers so tests can target seeded rows and re-seeds are idempotent.
export const SEED = {
  googleAccountId: '00000000-0000-4000-8000-000000000001',
  calendarId: '00000000-0000-4000-8000-000000000002',
  eventId: '00000000-0000-4000-8000-000000000003',
  kanbanTaskId: '00000000-0000-4000-8000-000000000004',
  searchTaskId: '00000000-0000-4000-8000-000000000005',
  bookingLinkId: '00000000-0000-4000-8000-000000000006',
  eventTitle: 'E2E Seed Event',
  eventAttendee: 'attendee@example.com',
  kanbanTaskTitle: 'E2E Drag Card',
  searchTaskTitle: 'Weekly Meeting Sync',
  // Public booking link the external booking-page spec exercises. Availability
  // covers all seven days 09:00–17:00 so tomorrow is always bookable; buffer and
  // minimum-notice are 0 so slots never get trimmed.
  bookingSlug: 'e2e-book',
  bookingLinkName: 'E2E Booking',
  // Prefix for cards the kanban "+ create" spec makes at runtime (cleaned each run).
  createdTaskPrefix: 'E2E Kanban Create',
} as const

const ALL_DAY_AVAILABILITY = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
].map((day) => ({ day, start: '09:00', end: '17:00' }))

/**
 * The Supabase URL + public key, from the environment or else the web app's
 * gitignored .env.local.
 */
function readSupabaseEnv(): { url: string; anonKey: string } {
  const fromEnv = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
  if (fromEnv.url && fromEnv.anonKey) return { url: fromEnv.url, anonKey: fromEnv.anonKey }

  const envPath = join(__dirname, '..', 'apps', 'web', '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  const get = (key: string) => {
    const line = raw.split('\n').find((l) => l.startsWith(`${key}=`))
    if (!line) throw new Error(`${key} not found in ${envPath}`)
    return line.slice(key.length + 1).trim()
  }
  return {
    url: get('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: get('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  }
}

/** Sign in as the seed user and return an authed client + the user's id. */
async function authedClient(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const { url, anonKey } = readSupabaseEnv()
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })
  if (error || !data.user) {
    throw new Error(`Seed sign-in failed for ${EMAIL}: ${error?.message ?? 'no user'}`)
  }
  return { supabase, userId: data.user.id }
}

/** Today's date (YYYY-MM-DD) in America/New_York, so the event lands in view. */
function todayInNewYork(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Upsert the fixed baseline. Idempotent: safe to run repeatedly, and each run
 * resets rows that mutation specs change back to their canonical state.
 */
export async function seedBaseline(): Promise<void> {
  const { supabase, userId } = await authedClient()

  const throwaway = (v: string) => `e2e-${v}-not-a-real-token`

  const gaRes = await supabase.from('google_accounts').upsert(
    {
      id: SEED.googleAccountId,
      user_id: userId,
      email: EMAIL,
      access_token: throwaway('access'),
      refresh_token: throwaway('refresh'),
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    },
    { onConflict: 'id' }
  )
  if (gaRes.error) throw new Error(`seed google_accounts: ${gaRes.error.message}`)

  const calRes = await supabase.from('calendars').upsert(
    {
      id: SEED.calendarId,
      user_id: userId,
      google_account_id: SEED.googleAccountId,
      google_calendar_id: 'e2e-primary',
      name: 'E2E Calendar',
      color: '#3b82f6',
      is_primary: true,
      is_active: true,
    },
    { onConflict: 'id' }
  )
  if (calRes.error) throw new Error(`seed calendars: ${calRes.error.message}`)

  const day = todayInNewYork()
  const evRes = await supabase.from('events').upsert(
    {
      id: SEED.eventId,
      user_id: userId,
      calendar_id: SEED.calendarId,
      title: SEED.eventTitle,
      start_time: `${day}T10:00:00-04:00`,
      end_time: `${day}T11:00:00-04:00`,
      timezone: 'America/New_York',
      is_all_day: false,
      // Attendees present so Event -> Task conversion triggers the
      // cancellation-warning dialog (#13).
      attendees: [{ email: SEED.eventAttendee, response_status: 'needsAction' }],
      status: 'confirmed',
      sync_status: 'synced',
    },
    { onConflict: 'id' }
  )
  if (evRes.error) throw new Error(`seed events: ${evRes.error.message}`)

  // Kanban drag target — lowest position so it is the first card in Backlog on
  // the default "current" board.
  const kanbanRes = await supabase.from('tasks').upsert(
    {
      id: SEED.kanbanTaskId,
      user_id: userId,
      title: SEED.kanbanTaskTitle,
      status: 'backlog',
      board: 'current',
      importance: 'normal',
      position: 100,
      // No scheduled_start -> stays off the calendar grid, only on the board.
    },
    { onConflict: 'id' }
  )
  if (kanbanRes.error) throw new Error(`seed kanban task: ${kanbanRes.error.message}`)

  // Search target — on the "future" board so it does not clutter the default
  // kanban view, but still matches the command-bar search ("meeting").
  const searchRes = await supabase.from('tasks').upsert(
    {
      id: SEED.searchTaskId,
      user_id: userId,
      title: SEED.searchTaskTitle,
      status: 'backlog',
      board: 'future',
      importance: 'normal',
      position: 200,
    },
    { onConflict: 'id' }
  )
  if (searchRes.error) throw new Error(`seed search task: ${searchRes.error.message}`)

  // Public booking link for the external booking-page spec (fixed id → idempotent).
  const blRes = await supabase.from('booking_links').upsert(
    {
      id: SEED.bookingLinkId,
      user_id: userId,
      slug: SEED.bookingSlug,
      name: SEED.bookingLinkName,
      duration_minutes: 30,
      availability: ALL_DAY_AVAILABILITY,
      timezone: 'America/New_York',
      is_public: true,
      requires_approval: false,
      buffer_minutes: 0,
      minimum_notice_hours: 0,
      conferencing: false,
    },
    { onConflict: 'id' }
  )
  if (blRes.error) throw new Error(`seed booking link: ${blRes.error.message}`)

  // Clear any bookings a prior run created against the seed link so its slots
  // are free again (the booking spec books one slot each run).
  const bookingCleanup = await supabase
    .from('bookings')
    .delete()
    .eq('booking_link_id', SEED.bookingLinkId)
  if (bookingCleanup.error) throw new Error(`seed booking cleanup: ${bookingCleanup.error.message}`)

  // The kanban "+ create" spec inserts an ad-hoc card each run; clear prior
  // ones so repeated runs start clean (and never collide on a title match).
  const cleanupRes = await supabase
    .from('tasks')
    .delete()
    .eq('user_id', userId)
    .like('title', `${SEED.createdTaskPrefix}%`)
  if (cleanupRes.error) throw new Error(`seed cleanup: ${cleanupRes.error.message}`)
}
