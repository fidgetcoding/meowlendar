import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../lib/auth/helpers'
import { createGoogleEvent } from '../../../lib/google/calendar'
import type { GoogleEventInsert } from '../../../lib/google/types'
import { createEventSchema } from '@poolendar/validators'
import { paginate } from '../../../lib/pagination'
import { eventsInWindowFilter, expandOccurrences, googleRecurrence, isValidRecurrenceRule } from '../../../lib/recurrence'
import type { CalendarEvent, CalendarItem, RoutineInstanceStatus } from '@poolendar/types'

// The kinds `GET /api/events` can return. `events` is always included (this is
// the events endpoint); `tasks` and `routines` are on by default and can be
// narrowed via `?include=`. This is the spec #22 acceptance surface: a task
// created with scheduled_start/scheduled_end comes back here without any drag.
const DEFAULT_INCLUDE = 'events,tasks,routines'

/** A routine_instances row joined to its parent routine. */
interface RoutineInstanceRow {
  id: string
  routine_id: string
  date: string
  status: RoutineInstanceStatus
  override_start_time: string | null
  override_end_time: string | null
  override_title: string | null
  routines: {
    user_id: string
    title: string
    start_time: string
    end_time: string
    timezone: string
    calendar_id: string | null
  } | null
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { searchParams } = request.nextUrl

  const start = searchParams.get('start')
  const end = searchParams.get('end')
  const calendarId = searchParams.get('calendar_id')

  if (!start || !end) {
    return NextResponse.json(
      { error: 'Missing required query parameters: start, end' },
      { status: 400 }
    )
  }

  const includeRaw = (searchParams.get('include') ?? DEFAULT_INCLUDE)
    .split(',')
    .map((s) => s.trim())
  const wantEvents = includeRaw.includes('events')
  const wantTasks = includeRaw.includes('tasks')
  const wantRoutines = includeRaw.includes('routines')

  const items: CalendarItem[] = []

  // --- Events ---------------------------------------------------------------
  // A series can have occurrences here long after its first one, so those rows are
  // fetched by rule and expanded. Each occurrence keeps the series id and says which
  // one it is in `occurrence_start`, for scoped edits and deletes.
  if (wantEvents) {
    let query = supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .or(eventsInWindowFilter(start, end))
      .order('start_time', { ascending: true })

    if (calendarId) query = query.eq('calendar_id', calendarId)

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
    }
    const windowStart = new Date(start)
    const windowEnd = new Date(end)
    for (const e of (data ?? []) as CalendarEvent[]) {
      if (!e.recurrence_rule) {
        items.push({ ...e, kind: 'event' } as CalendarItem)
        continue
      }
      for (const occurrence of expandOccurrences(e, windowStart, windowEnd)) {
        items.push({
          ...e,
          kind: 'event',
          start_time: occurrence.start.toISOString(),
          end_time: occurrence.end.toISOString(),
          occurrence_start: occurrence.start.toISOString(),
        } as CalendarItem)
      }
    }
  }

  // --- Scheduled tasks (spec #22) -------------------------------------------
  // A task overlaps the window when scheduled_start <= end AND scheduled_end >=
  // start. Split parents have their schedule cleared, so they fall out here and
  // only their children render (#23e). No parent_id filter: children belong on
  // the calendar exactly like standalone scheduled tasks.
  if (wantTasks) {
    let query = supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .not('scheduled_start', 'is', null)
      .lte('scheduled_start', end)
      .gte('scheduled_end', start)
      .order('scheduled_start', { ascending: true })

    if (calendarId) query = query.eq('calendar_id', calendarId)

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: 'Failed to fetch scheduled tasks' }, { status: 500 })
    }
    for (const t of data ?? []) items.push({ ...(t as object), kind: 'task' } as CalendarItem)
  }

  // --- Routine instances (best-effort; #22 "if cheap") ----------------------
  // Materialized instances whose date falls in the window, joined to their
  // routine for title/time. A failure here degrades to "no routines" rather
  // than failing the whole calendar read.
  if (wantRoutines) {
    const startDate = start.slice(0, 10)
    const endDate = end.slice(0, 10)
    const { data } = await supabase
      .from('routine_instances')
      .select(
        'id, routine_id, date, status, override_start_time, override_end_time, override_title, ' +
          'routines!inner(user_id, title, start_time, end_time, timezone, calendar_id)'
      )
      .gte('date', startDate)
      .lte('date', endDate)

    for (const ri of (data ?? []) as unknown as RoutineInstanceRow[]) {
      const routine = ri.routines
      if (!routine || routine.user_id !== userId) continue
      if (calendarId && routine.calendar_id !== calendarId) continue
      const date: string = ri.date
      const startTime: string = ri.override_start_time ?? routine.start_time
      const endTime: string = ri.override_end_time ?? routine.end_time
      const title: string = ri.override_title ?? routine.title
      items.push({
        kind: 'routine_instance',
        id: ri.id,
        routine_id: ri.routine_id,
        date,
        status: ri.status,
        title,
        scheduled_start: `${date}T${startTime}`,
        scheduled_end: `${date}T${endTime}`,
        timezone: routine.timezone,
        calendar_id: routine.calendar_id ?? null,
      })
    }
  }

  // Unify in calendar order (by effective start), then page.
  items.sort((a, b) => effectiveStart(a).localeCompare(effectiveStart(b)))

  return NextResponse.json(paginate(items, searchParams))
}

function effectiveStart(item: CalendarItem): string {
  if (item.kind === 'event') return item.start_time
  if (item.kind === 'task') return item.scheduled_start ?? ''
  return item.scheduled_start
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const parsed = createEventSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const input = parsed.data

  // Verify the calendar belongs to this user
  const { data: calendar, error: calendarError } = await supabase
    .from('calendars')
    .select('id, source, google_account_id, google_calendar_id')
    .eq('id', input.calendar_id)
    .eq('user_id', userId)
    .single()

  if (calendarError || !calendar) {
    return NextResponse.json(
      { error: 'Calendar not found or access denied' },
      { status: 404 }
    )
  }

  if (input.recurrence_rule && !isValidRecurrenceRule(input.recurrence_rule)) {
    return NextResponse.json({ error: 'recurrence_rule is not a valid RRULE' }, { status: 422 })
  }

  // Build the event row
  const eventRow = {
    user_id: userId,
    calendar_id: input.calendar_id,
    title: input.title,
    notes: input.notes ?? null,
    start_time: input.start_time,
    end_time: input.end_time,
    timezone: input.timezone,
    is_all_day: input.is_all_day,
    location: input.location ?? null,
    color_override: input.color_override ?? null,
    visibility: input.visibility,
    privacy: input.privacy,
    recurrence_rule: input.recurrence_rule ?? null,
    attendees: input.attendees,
    reminders: input.reminders,
    status: 'confirmed',
    sync_status: 'synced',
  }

  // Insert into Supabase first
  const { data: event, error: insertError } = await supabase
    .from('events')
    .insert(eventRow)
    .select()
    .single()

  if (insertError || !event) {
    return NextResponse.json(
      { error: 'Failed to create event' },
      { status: 500 }
    )
  }

  // A local calendar has nothing to sync to.
  if (calendar.source === 'local' || !calendar.google_account_id || !calendar.google_calendar_id) {
    return NextResponse.json(event, { status: 201 })
  }
  const { google_account_id: googleAccountId, google_calendar_id: googleCalendarId } = calendar

  // Sync to Google Calendar
  try {
    const googleEventBody: GoogleEventInsert = {
      summary: input.title,
      description: input.notes ?? undefined,
      location: input.location ?? undefined,
      visibility: input.privacy === 'private' ? 'private' : 'public',
      transparency: input.visibility === 'free' ? 'transparent' : 'opaque',
      start: input.is_all_day
        ? { date: input.start_time.split('T')[0], timeZone: input.timezone }
        : { dateTime: input.start_time, timeZone: input.timezone },
      end: input.is_all_day
        ? { date: input.end_time.split('T')[0], timeZone: input.timezone }
        : { dateTime: input.end_time, timeZone: input.timezone },
    }

    if (input.attendees.length > 0) {
      googleEventBody.attendees = input.attendees.map((a) => ({
        email: a.email,
        displayName: a.name,
      }))
    }

    if (input.recurrence_rule) {
      googleEventBody.recurrence = googleRecurrence(input.recurrence_rule)
    }

    if (input.reminders.length > 0) {
      googleEventBody.reminders = {
        useDefault: false,
        overrides: input.reminders.map((r) => ({
          method: 'popup',
          minutes: r.minutes_before,
        })),
      }
    }

    const googleResult = await createGoogleEvent(
      googleAccountId,
      googleCalendarId,
      googleEventBody,
      input.conferencing
    )

    // Update the local event with Google's IDs and conferencing URL
    const updateFields: Record<string, unknown> = {
      google_event_id: googleResult.id,
      etag: googleResult.etag,
      sync_status: 'synced',
    }

    if (googleResult.hangoutLink) {
      updateFields.conferencing_url = googleResult.hangoutLink
    }

    const { data: updatedEvent, error: updateError } = await supabase
      .from('events')
      .update(updateFields)
      .eq('id', event.id)
      .select()
      .single()

    if (updateError || !updatedEvent) {
      // Google sync succeeded but local update failed -- return what we have
      return NextResponse.json(
        { ...event, ...updateFields },
        { status: 201 }
      )
    }

    return NextResponse.json(updatedEvent, { status: 201 })
  } catch {
    // Google sync failed -- mark as pending and still return the event
    await supabase
      .from('events')
      .update({ sync_status: 'pending_push' })
      .eq('id', event.id)

    return NextResponse.json(
      { ...event, sync_status: 'pending_push' },
      { status: 201 }
    )
  }
}
