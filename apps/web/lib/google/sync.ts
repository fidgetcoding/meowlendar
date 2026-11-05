import { readAll } from '@/lib/read-all'
import { createServerClient } from '@supabase/ssr'
import type { CalendarEvent, Calendar } from '@poolendar/types'
import {
  getGoogleAccessToken,
  googleCalendarRequest,
  listGoogleEvents,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
} from './calendar'
import { requireEnv } from '../env'
import { googleApiBase } from '../external-urls'
import { syncCalendarList } from './oauth'
import { applyIncomingTaskEvent } from './task-sync'
import type {
  GoogleEvent,
  GoogleEventAttendee,
  GoogleEventInsert,
  GoogleEventWrite,
} from './types'
import { googleRecurrence, parseExceptionLines } from '../recurrence'

/** Calendar events carry retry bookkeeping columns that are not on CalendarEvent. */
type PendingPushEvent = CalendarEvent & { retry_count: number | null }

/** Google failures surface as thrown errors whose message includes the HTTP status. */
function errorMessageIncludes(err: unknown, text: string): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { message } = err as { message?: unknown }
  return typeof message === 'string' && message.includes(text)
}

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

// ─── Field Mappers ───────────────────────────────────────────────────────────

/**
 * Map a Google Calendar API event to our local events table schema.
 */
export function mapGoogleEventToLocal(
  googleEvent: GoogleEvent,
  calendarId: string,
  userId: string
): Partial<CalendarEvent> {
  const isAllDay = Boolean(googleEvent.start?.date)

  // For all-day events, store the bare date without UTC conversion
  const startTime = isAllDay
    ? `${googleEvent.start!.date}T00:00:00`  // Local midnight, no TZ shift
    : googleEvent.start?.dateTime
      ? new Date(googleEvent.start.dateTime).toISOString()
      : new Date().toISOString()

  const endTime = isAllDay
    ? `${googleEvent.end!.date}T00:00:00`
    : googleEvent.end?.dateTime
      ? new Date(googleEvent.end.dateTime).toISOString()
      : new Date().toISOString()

  const timezone =
    googleEvent.start?.timeZone ??
    googleEvent.end?.timeZone ??
    'America/New_York'

  const attendees: CalendarEvent['attendees'] = (
    googleEvent.attendees ?? []
  ).map((a: GoogleEventAttendee) => ({
    email: a.email,
    name: a.displayName ?? undefined,
    response_status: a.responseStatus ?? 'needsAction',
  }))

  const reminders: CalendarEvent['reminders'] =
    googleEvent.reminders?.overrides?.map((r) => ({
      minutes_before: r.minutes,
    })) ?? []

  // Google uses "transparent" for free, "opaque" (default) for busy
  const visibility: 'busy' | 'free' =
    googleEvent.transparency === 'transparent' ? 'free' : 'busy'

  // Google's visibility field maps to our privacy field
  const privacy: 'public' | 'private' =
    googleEvent.visibility === 'private' ||
    googleEvent.visibility === 'confidential'
      ? 'private'
      : 'public'

  // Extract conferencing URL (Google Meet or other)
  let conferencingUrl: string | null = null
  if (googleEvent.conferenceData?.entryPoints) {
    const videoEntry = googleEvent.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === 'video'
    )
    conferencingUrl = videoEntry?.uri ?? null
  }
  if (!conferencingUrl && googleEvent.hangoutLink) {
    conferencingUrl = googleEvent.hangoutLink
  }

  // Extract recurrence rule (first RRULE line if present)
  let recurrenceRule: string | null = null
  if (googleEvent.recurrence?.length) {
    const rruleLine = googleEvent.recurrence.find((r) =>
      r.startsWith('RRULE:')
    )
    recurrenceRule = rruleLine ?? googleEvent.recurrence[0]!
  }

  // Map Google event status
  let status: CalendarEvent['status'] = 'confirmed'
  if (googleEvent.status === 'tentative') status = 'tentative'
  if (googleEvent.status === 'cancelled') status = 'cancelled'

  return {
    user_id: userId,
    calendar_id: calendarId,
    google_event_id: googleEvent.id,
    title: googleEvent.summary ?? '(No title)',
    notes: googleEvent.description ?? null,
    start_time: startTime,
    end_time: endTime,
    timezone,
    is_all_day: isAllDay,
    location: googleEvent.location ?? null,
    color_override: googleEvent.colorId ?? null,
    visibility,
    privacy,
    conferencing_url: conferencingUrl,
    recurrence_rule: recurrenceRule,
    recurrence_id: googleEvent.recurringEventId ?? null,
    recurrence_exceptions: parseExceptionLines(googleEvent.recurrence),
    attendees,
    reminders,
    status,
    sync_status: 'synced' as const,
    etag: googleEvent.etag ?? null,
  }
}

/**
 * Map our local event to Google Calendar API format.
 */
export function mapLocalEventToGoogle(event: CalendarEvent): GoogleEventInsert {
  const isAllDay = event.is_all_day

  const start = isAllDay
    ? { date: event.start_time.slice(0, 10), timeZone: event.timezone }
    : { dateTime: event.start_time, timeZone: event.timezone }

  const end = isAllDay
    ? { date: event.end_time.slice(0, 10), timeZone: event.timezone }
    : { dateTime: event.end_time, timeZone: event.timezone }

  const googleEvent: GoogleEventInsert = {
    summary: event.title,
    start,
    end,
    transparency: event.visibility === 'free' ? 'transparent' : 'opaque',
    visibility: event.privacy === 'private' ? 'private' : 'default',
  }

  if (event.notes) {
    googleEvent.description = event.notes
  }

  if (event.location) {
    googleEvent.location = event.location
  }

  if (event.attendees.length > 0) {
    googleEvent.attendees = event.attendees.map((a) => ({
      email: a.email,
      displayName: a.name,
      responseStatus: a.response_status,
    }))
  }

  if (event.reminders.length > 0) {
    googleEvent.reminders = {
      useDefault: false,
      overrides: event.reminders.map((r) => ({
        method: 'popup',
        minutes: r.minutes_before,
      })),
    }
  } else {
    googleEvent.reminders = { useDefault: true }
  }

  if (event.recurrence_rule) {
    googleEvent.recurrence = googleRecurrence(event.recurrence_rule, event.recurrence_exceptions)
  }

  if (event.color_override) {
    googleEvent.colorId = event.color_override
  }

  return googleEvent
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

/**
 * Pull changes for every active calendar on an account, after refreshing the list
 * of calendars. Each calendar keeps its own sync token; with none, or when Google
 * expires one (410), it does a full window (30 days past + 365 days future).
 *
 * With a `deadlineMs`, it stops starting new calendars after that time and reports
 * `complete: false`. Finished calendars keep their tokens, so a later call resumes.
 */
export async function pullChanges(
  accountId: string,
  options: { deadlineMs?: number; waitForLeaseMs?: number } = {},
): Promise<{ created: number; updated: number; deleted: number; complete: boolean }> {
  const supabase = getServiceClient()
  const waitUntil = Date.now() + Math.max(0, options.waitForLeaseMs ?? 0)
  let token: string | null = null
  do {
    const { data, error } = await supabase.rpc('claim_account_sync', { p_account: accountId })
    if (error) throw new Error(`Failed to claim account sync: ${error.message}`)
    token = data
    if (token || Date.now() >= waitUntil) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, waitUntil - Date.now())))
  } while (true)
  if (!token) return { created: 0, updated: 0, deleted: 0, complete: false }
  const renew = async () => {
    const { data, error } = await supabase.rpc('renew_account_sync', { p_account: accountId, p_token: token })
    if (error || !data) throw new Error('Account sync lease lost; retry with the saved cursor')
  }
  try { return await pullAccountChanges(accountId, options, renew) }
  finally {
    const { error } = await supabase.rpc('release_account_sync', { p_account: accountId, p_token: token })
    if (error) console.error('[sync] failed to release account lease:', error.message)
  }
}

async function pullAccountChanges(
  accountId: string,
  options: { deadlineMs?: number },
  renew: () => Promise<void>,
): Promise<{ created: number; updated: number; deleted: number; complete: boolean }> {
  const supabase = getServiceClient()

  const { data: account, error: accountError } = await supabase
    .from('google_accounts')
    .select('user_id')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    throw new Error('Google account not found')
  }

  await syncCalendarList(accountId, account.user_id)
  await renew()

  const { data: calendars, error: calError } = await readAll(supabase
    .from('calendars')
    .select('id, google_calendar_id, sync_token, is_primary')
    .eq('google_account_id', accountId)
    .eq('is_active', true)
    .order('is_primary', { ascending: false }).order('id'))

  if (calError || !calendars) {
    throw new Error('Failed to fetch calendars')
  }

  let totalCreated = 0
  let totalUpdated = 0
  let totalDeleted = 0
  let complete = true

  for (const cal of calendars) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) {
      complete = false
      break
    }
    const result = await syncCalendar(
      accountId,
      cal.id,
      cal.google_calendar_id,
      account.user_id,
      cal.sync_token,
      renew,
    )
    totalCreated += result.created
    totalUpdated += result.updated
    totalDeleted += result.deleted

    await renew()
    if (result.newSyncToken) {
      const { error } = await supabase
        .from('calendars')
        .update({ sync_token: result.newSyncToken, last_synced_at: new Date().toISOString() })
        .eq('id', cal.id)
      if (error) throw new Error(`Failed to store sync cursor: ${error.message}`)
    }
  }

  if (complete) {
    const { error } = await supabase
      .from('google_accounts')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', accountId)
    if (error) throw new Error(`Failed to record account sync: ${error.message}`)
  }

  return { created: totalCreated, updated: totalUpdated, deleted: totalDeleted, complete }
}

/**
 * Sync a single calendar, handling pagination and 410 fallback.
 */
async function syncCalendar(
  accountId: string,
  localCalendarId: string,
  googleCalendarId: string,
  userId: string,
  syncToken: string | null,
  renew: () => Promise<void>,
): Promise<{
  created: number
  updated: number
  deleted: number
  newSyncToken: string | null
}> {
  const supabase = getServiceClient()
  let created = 0
  let updated = 0
  let deleted = 0
  let pageToken: string | undefined
  let currentSyncToken = syncToken
  let newSyncToken: string | null = null
  let needsFullSync = !currentSyncToken

  // Attempt incremental sync; fall back to full on 410
  const fetchPage = async () => {
    if (needsFullSync) {
      const now = new Date()
      const timeMin = new Date(
        now.getTime() - 30 * 24 * 60 * 60 * 1000
      ).toISOString()
      const timeMax = new Date(
        now.getTime() + 365 * 24 * 60 * 60 * 1000
      ).toISOString()
      return listGoogleEvents(accountId, googleCalendarId, {
        timeMin,
        timeMax,
        pageToken,
      })
    }

    try {
      return await listGoogleEvents(accountId, googleCalendarId, {
        syncToken: currentSyncToken!,
        pageToken,
      })
    } catch (err) {
      // 410 Gone — syncToken expired, fall back to full sync
      if (errorMessageIncludes(err, '410')) {
        needsFullSync = true
        currentSyncToken = null
        pageToken = undefined
        const now = new Date()
        const timeMin = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000
        ).toISOString()
        const timeMax = new Date(
          now.getTime() + 365 * 24 * 60 * 60 * 1000
        ).toISOString()
        return listGoogleEvents(accountId, googleCalendarId, {
          timeMin,
          timeMax,
          pageToken,
        })
      }
      throw err
    }
  }

  do {
    const page = await fetchPage()
    await renew()
    let renewedAt = Date.now()
    const events = page.items ?? []

    for (const googleEvent of events) {
      if (Date.now() - renewedAt > 30_000) { await renew(); renewedAt = Date.now() }
      // Skip cancelled events in full sync — they're just noise
      if (
        googleEvent.status === 'cancelled' &&
        needsFullSync &&
        !currentSyncToken
      ) {
        // In incremental sync, cancelled = delete signal
        // In full sync, just skip them
        continue
      }

      const result = await upsertEvent(
        supabase,
        googleEvent,
        localCalendarId,
        userId
      )
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else if (result === 'deleted') deleted++
    }

    pageToken = page.nextPageToken
    if (!page.nextPageToken && page.nextSyncToken) {
      newSyncToken = page.nextSyncToken
    }
  } while (pageToken)

  return { created, updated, deleted, newSyncToken }
}

/** Records one occurrence of a series as removed from its master row. */
async function addMasterException(
  supabase: ReturnType<typeof getServiceClient>,
  calendarId: string,
  masterGoogleId: string,
  original: { dateTime?: string; date?: string },
): Promise<void> {
  const when = original.dateTime ?? (original.date ? `${original.date}T00:00:00Z` : null)
  if (!when) return

  const { data: master, error: masterError } = await supabase
    .from('events')
    .select('id, recurrence_exceptions')
    .eq('calendar_id', calendarId)
    .eq('google_event_id', masterGoogleId)
    .maybeSingle()
  if (masterError) throw new Error(`Failed to read recurring master: ${masterError.message}`)
  if (!master) return

  const iso = new Date(when).toISOString()
  const current: string[] = (master.recurrence_exceptions ?? []).map((value: string) =>
    new Date(value).toISOString()
  )
  if (current.includes(iso)) return
  const { error } = await supabase
    .from('events')
    .update({ recurrence_exceptions: [...current, iso] })
    .eq('id', master.id)
  if (error) throw new Error(`Failed to store recurring exception: ${error.message}`)
}

/**
 * Upsert a single Google event into the local database.
 * Returns 'created', 'updated', or 'deleted'.
 */
async function upsertEvent(
  supabase: ReturnType<typeof getServiceClient>,
  googleEvent: GoogleEvent,
  calendarId: string,
  userId: string
): Promise<'created' | 'updated' | 'deleted'> {
  // A task we mirrored to this calendar. It stays a task and never becomes an event.
  const taskResult = await applyIncomingTaskEvent(supabase, googleEvent, userId, calendarId)
  if (taskResult) return taskResult

  // Check if this event already exists locally
  const { data: existing, error: readError } = await supabase
    .from('events')
    .select('id, etag, sync_status, updated_at')
    .eq('calendar_id', calendarId)
    .eq('google_event_id', googleEvent.id)
    .maybeSingle()

  if (readError) throw new Error(`Failed to read synced event: ${readError.message}`)

  // Pending local edits win over remote cancellation as well as updates.
  if (existing?.sync_status === 'pending_push') return 'updated'

  // A changed or cancelled occurrence of a series: the master stops showing it.
  if (googleEvent.recurringEventId && googleEvent.originalStartTime) {
    await addMasterException(supabase, calendarId, googleEvent.recurringEventId, googleEvent.originalStartTime)
  }

  // Cancelled event = delete locally
  if (googleEvent.status === 'cancelled') {
    if (existing) {
      const { error } = await supabase.from('events').delete().eq('id', existing.id).eq('updated_at', existing.updated_at).neq('sync_status', 'pending_push')
      if (error) throw new Error(`Failed to delete synced event: ${error.message}`)
    }
    return 'deleted'
  }

  const mapped = mapGoogleEventToLocal(googleEvent, calendarId, userId)

  if (existing) {
    // An edit made here is waiting to go out. Taking Google's copy now would lose
    // it; the push resolves any conflict instead.
    if (existing.sync_status === 'pending_push') {
      return 'updated'
    }

    // Skip update if etag hasn't changed
    if (existing.etag && existing.etag === googleEvent.etag) {
      return 'updated' // No actual change, but counted for reporting
    }

    const { error } = await supabase
      .from('events')
      .update({
        ...mapped,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('updated_at', existing.updated_at)
      .neq('sync_status', 'pending_push')
    if (error) throw new Error(`Failed to update synced event: ${error.message}`)
    return 'updated'
  }

  const { data, error } = await supabase.rpc('insert_google_event_once', { p_event: mapped })
  if (error) throw new Error(`Failed to insert synced event: ${error.message}`)
  return data as 'created' | 'updated'
}

// ─── Push & Delete ───────────────────────────────────────────────────────────

/**
 * Push a local event to Google Calendar.
 * Creates if no google_event_id, updates if one exists.
 * Handles ETag 412 conflicts with last-write-wins merge.
 */
export async function pushEvent(
  event: CalendarEvent,
  calendar: Calendar,
  conferencing = Boolean(event.conferencing_url),
): Promise<CalendarEvent> {
  const { google_account_id: accountId, google_calendar_id: googleCalendarId } = calendar
  if (!accountId || !googleCalendarId) {
    throw new Error('Cannot push to a local calendar')
  }
  const supabase = getServiceClient()
  const wasUnlinked = !event.google_event_id
  const { data: prepared, error: prepareError } = await supabase.rpc('prepare_event_push', { p_id: event.id })
  if (prepareError || !prepared) throw new Error(`Failed to prepare event push: ${prepareError?.message ?? 'event deleted'}`)
  event = prepared as CalendarEvent
  if (event.calendar_id !== calendar.id || !event.google_event_id) throw new Error('Event calendar changed before push')
  const googlePayload = mapLocalEventToGoogle(event)

  let googleResponse: GoogleEvent

  if (event.google_event_id && !wasUnlinked) {
    // Update existing Google event
    try {
      googleResponse = await updateGoogleEventWithEtag(
        accountId,
        googleCalendarId,
        event.google_event_id,
        googlePayload,
        event.etag
      )
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status
      if (status === 412 || errorMessageIncludes(err, '412')) {
        // ETag conflict — fetch latest from Google, merge, re-push
        googleResponse = await resolveConflict(
          accountId,
          googleCalendarId,
          event.google_event_id,
          event,
          googlePayload
        )
      } else if (status === 404 || errorMessageIncludes(err, '404')) {
        googleResponse = await createGoogleEvent(accountId, googleCalendarId, { ...googlePayload, id: event.google_event_id }, conferencing)
      } else {
        throw err
      }
    }
  } else {
    // A stable ID makes concurrent creates and retries idempotent.
    try {
      googleResponse = await createGoogleEvent(accountId, googleCalendarId, { ...googlePayload, id: event.google_event_id as string }, conferencing)
    } catch (error) {
      if (!errorMessageIncludes(error, '409')) throw error
      googleResponse = await updateGoogleEvent(accountId, googleCalendarId, event.google_event_id as string, googlePayload)
    }
  }

  const conferencingUrl = googleResponse.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video')?.uri ?? googleResponse.hangoutLink ?? null
  const { data: updated, error } = await supabase.rpc('finish_event_push', {
    p_event: event,
    p_google: { id: googleResponse.id, etag: googleResponse.etag, conferencing_url: conferencingUrl },
  })
  if (error || !updated) throw new Error(`Failed to finish event push: ${error?.message ?? 'event deleted'}`)
  return updated as CalendarEvent
}

/**
 * Update a Google event with ETag-based optimistic concurrency.
 * Throws with status 412 on conflict.
 */
async function updateGoogleEventWithEtag(
  accountId: string,
  calendarId: string,
  googleEventId: string,
  payload: GoogleEventWrite,
  etag: string | null
): Promise<GoogleEvent> {
  const accessToken = await getGoogleAccessToken(accountId)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  if (etag) {
    headers['If-Match'] = etag
  }

  const response = await fetch(
    `${googleApiBase()}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw Object.assign(
      new Error(`Google Calendar update failed: ${response.status} ${body}`),
      { status: response.status }
    )
  }

  return response.json()
}

/**
 * Resolve an ETag conflict using last-write-wins per field.
 * Fetches the latest version from Google, merges our changes on top,
 * then pushes the merged result.
 */
async function resolveConflict(
  accountId: string,
  calendarId: string,
  googleEventId: string,
  localEvent: CalendarEvent,
  localPayload: GoogleEventWrite
): Promise<GoogleEvent> {
  // Fetch the latest version from Google
  const accessToken = await getGoogleAccessToken(accountId)
  const latest = await googleCalendarRequest(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`
  )

  // Merge: our local payload takes precedence (last-write-wins)
  const merged: Partial<GoogleEvent> = { ...latest, ...localPayload }

  // Remove read-only fields that can't be sent back
  delete merged.kind
  delete merged.etag
  delete merged.id
  delete merged.htmlLink
  delete merged.created
  delete merged.updated
  delete merged.creator
  delete merged.organizer
  delete merged.iCalUID

  // Push the merged result without If-Match (force write)
  return updateGoogleEvent(accountId, calendarId, googleEventId, merged)
}

/**
 * Delete an event from Google Calendar if it has a google_event_id.
 */
export async function deleteRemoteEvent(
  event: CalendarEvent,
  calendar: Calendar
): Promise<void> {
  if (!event.google_event_id || !calendar.google_account_id || !calendar.google_calendar_id) {
    return // Nothing to delete on Google's side
  }

  await deleteGoogleEvent(
    calendar.google_account_id,
    calendar.google_calendar_id,
    event.google_event_id
  )
}

// ─── Pending-push Retry ──────────────────────────────────────────────────────

/** Give up on a stranded push after this many attempts. */
export const MAX_PUSH_RETRIES = 5

/**
 * Re-push events left in `sync_status = 'pending_push'` — the state an event
 * lands in when its inline Google write failed (events/route.ts). Without this
 * pass those events strand forever.
 *
 * Selection is gated on `retry_count < MAX_PUSH_RETRIES` and a due
 * `next_retry_at`, so exhausted events drop out and backed-off events wait.
 * On failure we bump retry_count and push next_retry_at out exponentially
 * (2^n minutes, capped at 60). pushEvent flips the row back to 'synced' on
 * success.
 */
export async function retryPendingPushEvents(
  options: { userId?: string } = {}
): Promise<{
  retried: number
  succeeded: number
  failed: number
  gaveUp: number
}> {
  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()

  let eventQuery = supabase
    .from('events')
    .select('*')
    .eq('sync_status', 'pending_push')
    .lt('retry_count', MAX_PUSH_RETRIES)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .limit(100)
  if (options.userId) eventQuery = eventQuery.eq('user_id', options.userId)

  const { data: events } = await eventQuery

  let retried = 0
  let succeeded = 0
  let failed = 0
  let gaveUp = 0

  for (const event of (events ?? []) as PendingPushEvent[]) {
    retried++

    const { data: calendar } = await supabase
      .from('calendars')
      .select('*')
      .eq('id', event.calendar_id)
      .single()

    if (!calendar) {
      // Calendar gone (account disconnected) — this event can never sync.
      await supabase
        .from('events')
        .update({ retry_count: MAX_PUSH_RETRIES })
        .eq('id', event.id)
      gaveUp++
      continue
    }

    try {
      await pushEvent(event, calendar as Calendar)
      succeeded++
    } catch {
      const retryCount = (event.retry_count ?? 0) + 1
      const delayMinutes = Math.min(2 ** retryCount, 60)
      const nextRetryAt = new Date(
        Date.now() + delayMinutes * 60_000
      ).toISOString()

      await supabase
        .from('events')
        .update({ retry_count: retryCount, next_retry_at: nextRetryAt })
        .eq('id', event.id).eq('updated_at', event.updated_at).eq('sync_status', 'pending_push')

      if (retryCount >= MAX_PUSH_RETRIES) gaveUp++
      else failed++
    }
  }

  return { retried, succeeded, failed, gaveUp }
}

// ─── Deletes made outside the API ────────────────────────────────────────────

/**
 * Carries deletes made directly in the browser over to Google. Each one is removed
 * once Google confirms, or already has no such event. A failure stays for next time.
 */
export async function flushEventTombstones(
  options: { userId?: string } = {}
): Promise<{ deleted: number; failed: number }> {
  const supabase = getServiceClient()
  let query = supabase
    .from('google_event_tombstones')
    .select('id, google_account_id, google_calendar_id, google_event_id')
    .limit(100)
  if (options.userId) query = query.eq('user_id', options.userId)

  const { data: tombstones } = await query
  let deleted = 0
  let failed = 0
  for (const t of tombstones ?? []) {
    try {
      await deleteGoogleEvent(t.google_account_id, t.google_calendar_id, t.google_event_id)
      await supabase.from('google_event_tombstones').delete().eq('id', t.id)
      deleted++
    } catch (err) {
      failed++
      console.error('[google/sync] delete failed, will retry:', err)
    }
  }
  return { deleted, failed }
}
