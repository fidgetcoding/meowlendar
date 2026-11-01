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
 * Pull changes from Google Calendar using incremental sync.
 * If no syncToken exists or Google returns 410 (expired token),
 * falls back to a full sync window (30 days past + 365 days future).
 */
export async function pullChanges(
  accountId: string
): Promise<{ created: number; updated: number; deleted: number }> {
  const supabase = getServiceClient()

  // Fetch the account's sync_token and user_id
  const { data: account, error: accountError } = await supabase
    .from('google_accounts')
    .select('sync_token, user_id')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    throw new Error('Google account not found')
  }

  // Fetch all active calendars for this account
  const { data: calendars, error: calError } = await supabase
    .from('calendars')
    .select('id, google_calendar_id')
    .eq('google_account_id', accountId)
    .eq('is_active', true)

  if (calError || !calendars) {
    throw new Error('Failed to fetch calendars')
  }

  let totalCreated = 0
  let totalUpdated = 0
  let totalDeleted = 0

  for (const cal of calendars) {
    const result = await syncCalendar(
      accountId,
      cal.id,
      cal.google_calendar_id,
      account.user_id,
      account.sync_token
    )
    totalCreated += result.created
    totalUpdated += result.updated
    totalDeleted += result.deleted

    // Store the latest sync token (from the last page of the last calendar)
    if (result.newSyncToken) {
      await supabase
        .from('google_accounts')
        .update({
          sync_token: result.newSyncToken,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', accountId)
    }
  }

  return { created: totalCreated, updated: totalUpdated, deleted: totalDeleted }
}

/**
 * Initial-connect sync of just the primary calendar (past 30 days → next 365).
 *
 * Deliberately bounded to one calendar so it can run inline in the OAuth
 * callback without risking a function timeout. It does NOT persist a sync_token
 * or last_synced_at, so the account still reads as "never synced" — the
 * sync-poll cron then does the authoritative full-account sync (all calendars)
 * and establishes the incremental token. The re-sync is idempotent (etag skip).
 */
export async function initialSyncPrimaryCalendar(
  accountId: string
): Promise<{ created: number; updated: number; deleted: number }> {
  const supabase = getServiceClient()

  const { data: account, error: accountError } = await supabase
    .from('google_accounts')
    .select('user_id')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    throw new Error('Google account not found')
  }

  const { data: calendars } = await supabase
    .from('calendars')
    .select('id, google_calendar_id, is_primary')
    .eq('google_account_id', accountId)
    .eq('is_active', true)

  if (!calendars || calendars.length === 0) {
    return { created: 0, updated: 0, deleted: 0 }
  }

  const primary = calendars.find((c) => c.is_primary) ?? calendars[0]!

  const result = await syncCalendar(
    accountId,
    primary.id,
    primary.google_calendar_id,
    account.user_id,
    null // force the full-window path; discard the returned syncToken
  )

  return {
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
  }
}

/**
 * Sync a single calendar, handling pagination and 410 fallback.
 */
async function syncCalendar(
  accountId: string,
  localCalendarId: string,
  googleCalendarId: string,
  userId: string,
  syncToken: string | null
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
    const events = page.items ?? []

    for (const googleEvent of events) {
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
  // Check if this event already exists locally
  const { data: existing } = await supabase
    .from('events')
    .select('id, etag')
    .eq('calendar_id', calendarId)
    .eq('google_event_id', googleEvent.id)
    .single()

  // Cancelled event = delete locally
  if (googleEvent.status === 'cancelled') {
    if (existing) {
      await supabase.from('events').delete().eq('id', existing.id)
    }
    return 'deleted'
  }

  const mapped = mapGoogleEventToLocal(googleEvent, calendarId, userId)

  if (existing) {
    // Skip update if etag hasn't changed
    if (existing.etag && existing.etag === googleEvent.etag) {
      return 'updated' // No actual change, but counted for reporting
    }

    await supabase
      .from('events')
      .update({
        ...mapped,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    return 'updated'
  }

  // Insert new event
  await supabase.from('events').insert({
    ...mapped,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return 'created'
}

// ─── Push & Delete ───────────────────────────────────────────────────────────

/**
 * Push a local event to Google Calendar.
 * Creates if no google_event_id, updates if one exists.
 * Handles ETag 412 conflicts with last-write-wins merge.
 */
export async function pushEvent(
  event: CalendarEvent,
  calendar: Calendar
): Promise<CalendarEvent> {
  const { google_account_id: accountId, google_calendar_id: googleCalendarId } = calendar
  if (!accountId || !googleCalendarId) {
    throw new Error('Cannot push to a local calendar')
  }
  const supabase = getServiceClient()
  const googlePayload = mapLocalEventToGoogle(event)

  let googleResponse: GoogleEvent

  if (event.google_event_id) {
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
      } else {
        throw err
      }
    }
  } else {
    // Create new event on Google
    googleResponse = await createGoogleEvent(
      accountId,
      googleCalendarId,
      googlePayload,
      Boolean(event.conferencing_url)
    )
  }

  // Update local record with Google's response
  const updatedFields: Partial<CalendarEvent> = {
    google_event_id: googleResponse.id,
    etag: googleResponse.etag,
    sync_status: 'synced',
    updated_at: new Date().toISOString(),
  }

  // If Google assigned a conferencing URL, capture it
  if (googleResponse.conferenceData?.entryPoints) {
    const videoEntry = googleResponse.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === 'video'
    )
    if (videoEntry?.uri) {
      updatedFields.conferencing_url = videoEntry.uri
    }
  } else if (googleResponse.hangoutLink) {
    updatedFields.conferencing_url = googleResponse.hangoutLink
  }

  const { data: updated, error } = await supabase
    .from('events')
    .update(updatedFields)
    .eq('id', event.id)
    .select()
    .single()

  if (error || !updated) {
    throw new Error(`Failed to update local event after push: ${error?.message}`)
  }

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
export async function retryPendingPushEvents(): Promise<{
  retried: number
  succeeded: number
  failed: number
  gaveUp: number
}> {
  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .eq('sync_status', 'pending_push')
    .lt('retry_count', MAX_PUSH_RETRIES)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .limit(100)

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
        .eq('id', event.id)

      if (retryCount >= MAX_PUSH_RETRIES) gaveUp++
      else failed++
    }
  }

  return { retried, succeeded, failed, gaveUp }
}
