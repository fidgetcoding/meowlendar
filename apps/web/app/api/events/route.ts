
import { readAll } from '@/lib/read-all'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError, type AuthResult } from '../../../lib/auth/helpers'
import { pushEvent } from '../../../lib/google/sync'
import { alreadyCreated, clientIdOf, UNIQUE_VIOLATION } from '../../../lib/client-id'
import { createEventSchema } from '@poolendar/validators'
import { paginate } from '../../../lib/pagination'
import { eventsInWindowFilter, expandOccurrences, isValidRecurrenceRule } from '../../../lib/recurrence'
import type { Calendar, CalendarEvent, CalendarItem, EventCopyRef, RoutineInstanceStatus } from '@poolendar/types'
import { copyRank, mergeCopies, ownResponse } from '../../../lib/event-merge'

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

    if (calendarId) {
      query = query.eq('calendar_id', calendarId)
    } else {
      // A calendar turned off in settings stays out of the default view.
      const { data: hidden } = await readAll(supabase
        .from('calendars')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', false).order('id'))
      if (hidden?.length) {
        query = query.not('calendar_id', 'in', `(${hidden.map((c) => c.id).join(',')})`)
      }
    }

    const { data, error } = await readAll(query.order('id'))
    if (error) {
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
    }
    const windowStart = new Date(start)
    const windowEnd = new Date(end)
    const eventItems: EventItem[] = []
    for (const e of (data ?? []) as CalendarEvent[]) {
      if (!e.recurrence_rule) {
        eventItems.push({ ...e, kind: 'event' })
        continue
      }
      for (const occurrence of expandOccurrences(e, windowStart, windowEnd)) {
        eventItems.push({
          ...e,
          kind: 'event',
          start_time: occurrence.start.toISOString(),
          end_time: occurrence.end.toISOString(),
          occurrence_start: occurrence.start.toISOString(),
        })
      }
    }
    // A meeting on several calendars or accounts comes back once, as on the grid,
    // unless `merge=false` asks for every row.
    items.push(...(searchParams.get('merge') === 'false' ? eventItems : await mergeEventCopies(supabase, userId, eventItems)))
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

    const { data, error } = await readAll(query.order('id'))
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
    const { data } = await readAll(supabase
      .from('routine_instances')
      .select(
        'id, routine_id, date, status, override_start_time, override_end_time, override_title, ' +
          'routines!inner(user_id, title, start_time, end_time, timezone, calendar_id)'
      )
      .gte('date', startDate)
      .lte('date', endDate).order('id'))

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

  return NextResponse.json(paginate(items, searchParams, (item) =>
    item.kind === 'event' && item.occurrence_start
      ? `${item.id}::${item.occurrence_start}`
      : item.id,
  ))
}

type EventItem = Extract<CalendarItem, { kind: 'event' }>

/**
 * Keeps one copy of each meeting by the grid's rules (lib/event-merge) and lists the
 * others on it as `also_on`, with the account each came through and your answer there.
 */
async function mergeEventCopies(supabase: AuthResult['supabase'], userId: string, events: EventItem[]): Promise<EventItem[]> {
  if (new Set(events.map((e) => e.calendar_id)).size < 2) return events
  const [{ data: calendars }, { data: accounts }] = await Promise.all([
    supabase.from('calendars').select('id, source, access_role, is_primary, google_account_id').eq('user_id', userId),
    supabase.from('google_accounts').select('id, email').eq('user_id', userId),
  ])
  const calendarById = new Map(((calendars ?? []) as Pick<Calendar, 'id' | 'source' | 'access_role' | 'is_primary' | 'google_account_id'>[]).map((c) => [c.id, c]))
  const emailOf = new Map(((accounts ?? []) as { id: string; email: string }[]).map((a) => [a.id, a.email]))
  const { shown, hidden } = mergeCopies(
    events,
    (e) => ({ calendarId: e.calendar_id, icalUid: e.ical_uid, title: e.title, start: Date.parse(e.start_time), end: Date.parse(e.end_time) }),
    (e) => copyRank(e, calendarById.get(e.calendar_id)),
  )
  return shown.map((e) => {
    const copies = hidden.get(e)
    if (!copies) return e
    const also_on: EventCopyRef[] = copies.map((copy) => {
      const accountId = calendarById.get(copy.calendar_id)?.google_account_id
      const accountEmail = accountId ? emailOf.get(accountId) ?? null : null
      return {
        event_id: copy.id,
        calendar_id: copy.calendar_id,
        account_email: accountEmail,
        google_event_id: copy.google_event_id,
        response_status: ownResponse(copy, accountEmail),
      }
    })
    return { ...e, also_on }
  })
}

function effectiveStart(item: CalendarItem): string {
  if (item.kind === 'event') return item.start_time
  if (item.kind === 'task') return item.scheduled_start ?? ''
  return item.scheduled_start
}

const hasField = (body: unknown, key: string) =>
  Boolean(body) && typeof body === 'object' && (body as Record<string, unknown>)[key] !== undefined

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

  // The same create sent twice (the page resends it while unloading) makes one row.
  const clientId = clientIdOf(body)
  if (clientId) {
    const already = await alreadyCreated(supabase, 'events', clientId, userId)
    if (already) return NextResponse.json(already, { status: 200 })
  }

  // Build the event row
  const eventRow = {
    ...(clientId ? { id: clientId } : {}),
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
    // Unless the caller says, an all-day event shows as free (a birthday shouldn't block a whole
    // day of bookings) and a timed one as busy, as Google does.
    visibility: hasField(body, 'visibility') ? input.visibility : input.is_all_day ? 'free' : 'busy',
    privacy: input.privacy,
    recurrence_rule: input.recurrence_rule ?? null,
    attendees: input.attendees,
    reminders: input.reminders,
    status: 'confirmed',
    sync_status: calendar.source === 'local' ? 'synced' : 'pending_push',
  }

  // Insert into Supabase first
  const { data: event, error: insertError } = await supabase
    .from('events')
    .insert(eventRow)
    .select()
    .single()

  if (insertError?.code === UNIQUE_VIOLATION && clientId) {
    const already = await alreadyCreated(supabase, 'events', clientId, userId)
    if (already) return NextResponse.json(already, { status: 200 })
  }
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
  try {
    const pushed = await pushEvent(event as CalendarEvent, calendar as Calendar, input.conferencing)
    return NextResponse.json(pushed, { status: 201 })
  } catch {
    // The local row is already pending; never overwrite a newer edit here.
    const { data: latest } = await supabase.from('events').select('*').eq('id', event.id).maybeSingle()
    return NextResponse.json(latest ?? event, { status: 201 })
  }
}
