import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../lib/auth/helpers'
import { originOf } from '../../../lib/auth/origin'
import { convertSchema } from '@poolendar/validators'
import {
  createGoogleEvent,
  deleteGoogleEvent,
} from '../../../lib/google/calendar'
import { googleRecurrence } from '@/lib/recurrence'

/**
 * A Google event id chosen before Google sees the event, in its base32hex alphabet.
 * A sync running meanwhile then finds this row instead of adding a second one.
 */
function newGoogleEventId(): string {
  return `me${crypto.randomUUID().replace(/-/g, '')}`
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = convertSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const { source_type, source_id, target_type, calendar_id, repeat_pattern } = parsed.data

  // Fetch source entity
  const { data: source, error: sourceError } = await supabase
    .from(`${source_type}s`)
    .select('*')
    .eq('id', source_id)
    .eq('user_id', userId)
    .single()

  if (sourceError || !source) {
    return NextResponse.json({ error: `${source_type} not found` }, { status: 404 })
  }

  let result: { type: 'event' | 'task' | 'routine'; data: unknown } | null = null

  // EVENT -> TASK
  if (source_type === 'event' && target_type === 'task') {
    // Delete from Google if synced
    if (source.google_event_id && source.calendar_id) {
      const { data: cal } = await supabase
        .from('calendars')
        .select('google_account_id, google_calendar_id')
        .eq('id', source.calendar_id)
        .single()
      if (cal?.google_account_id && cal.google_calendar_id) {
        try {
          await deleteGoogleEvent(cal.google_account_id, cal.google_calendar_id, source.google_event_id)
        } catch { /* best effort */ }
      }
    }

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert({
        user_id: userId,
        title: source.title,
        notes: source.notes,
        scheduled_start: source.start_time,
        scheduled_end: source.end_time,
        location: source.location,
        visibility: source.visibility,
        privacy: source.privacy,
        reminders: source.reminders,
        status: 'backlog',
        board: 'current',
        created_via: originOf(auth),
      })
      .select()
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }

    const { error: deleteError } = await supabase.from('events').delete().eq('id', source_id).eq('user_id', userId)
    if (deleteError) {
      // Rollback: delete the newly created target
      await supabase.from('tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: 'Conversion failed: could not delete source' }, { status: 500 })
    }
    result = { type: 'task', data: task }
  }

  // EVENT -> ROUTINE
  else if (source_type === 'event' && target_type === 'routine') {
    if (!repeat_pattern) {
      return NextResponse.json({ error: 'repeat_pattern is required for conversion to routine' }, { status: 400 })
    }

    if (source.google_event_id && source.calendar_id) {
      const { data: cal } = await supabase
        .from('calendars')
        .select('google_account_id, google_calendar_id')
        .eq('id', source.calendar_id)
        .single()
      if (cal?.google_account_id && cal.google_calendar_id) {
        try {
          await deleteGoogleEvent(cal.google_account_id, cal.google_calendar_id, source.google_event_id)
        } catch { /* best effort */ }
      }
    }

    const startTime = new Date(source.start_time)
    const endTime = new Date(source.end_time)
    const startTimeStr = `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`
    const endTimeStr = `${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`

    const { data: routine, error: routineError } = await supabase
      .from('routines')
      .insert({
        user_id: userId,
        title: source.title,
        notes: source.notes,
        start_time: startTimeStr,
        end_time: endTimeStr,
        timezone: source.timezone || 'America/New_York',
        recurrence_rule: repeat_pattern,
        location: source.location,
        visibility: source.visibility,
        privacy: source.privacy,
        reminders: source.reminders,
      })
      .select()
      .single()

    if (routineError || !routine) {
      return NextResponse.json({ error: 'Failed to create routine' }, { status: 500 })
    }

    const { error: deleteError2 } = await supabase.from('events').delete().eq('id', source_id).eq('user_id', userId)
    if (deleteError2) {
      await supabase.from('routines').delete().eq('id', routine.id)
      return NextResponse.json({ error: 'Conversion failed: could not delete source' }, { status: 500 })
    }
    result = { type: 'routine', data: routine }
  }

  // TASK -> EVENT
  else if (source_type === 'task' && target_type === 'event') {
    if (!calendar_id) {
      return NextResponse.json({ error: 'calendar_id is required for conversion to event' }, { status: 400 })
    }

    const { data: cal } = await supabase
      .from('calendars')
      .select('id, google_account_id, google_calendar_id')
      .eq('id', calendar_id)
      .eq('user_id', userId)
      .single()

    if (!cal) {
      return NextResponse.json({ error: 'Calendar not found' }, { status: 404 })
    }

    const startTime = source.scheduled_start || new Date().toISOString()
    const endTime = source.scheduled_end || new Date(Date.now() + (source.time_estimate_minutes || 30) * 60000).toISOString()

    const eventRow: Record<string, unknown> = {
      user_id: userId,
      calendar_id: calendar_id,
      title: source.title,
      notes: source.notes,
      start_time: startTime,
      end_time: endTime,
      timezone: 'America/New_York',
      location: source.location,
      visibility: source.visibility,
      privacy: source.privacy === 'private' ? 'private' : 'public',
      reminders: source.reminders,
      status: 'confirmed',
      sync_status: 'synced',
      google_event_id: cal.google_account_id ? newGoogleEventId() : null,
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert(eventRow)
      .select()
      .single()

    if (eventError || !event) {
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
    }

    try {
      // A local calendar has nothing to push to. The database keeps its events
      // marked synced, so landing in the catch below does no harm.
      if (!cal.google_account_id || !cal.google_calendar_id) {
        throw new Error('Local calendar')
      }
      const googleResult = await createGoogleEvent(
        cal.google_account_id,
        cal.google_calendar_id,
        {
          id: event.google_event_id ?? undefined,
          summary: source.title,
          description: source.notes || undefined,
          start: { dateTime: startTime, timeZone: 'America/New_York' },
          end: { dateTime: endTime, timeZone: 'America/New_York' },
          location: source.location || undefined,
        }
      )

      await supabase
        .from('events')
        .update({
          google_event_id: googleResult.id,
          etag: googleResult.etag,
          conferencing_url: googleResult.hangoutLink || null,
        })
        .eq('id', event.id)
    } catch {
      await supabase
        .from('events')
        .update({ sync_status: 'pending_push' })
        .eq('id', event.id)
    }

    const { error: deleteError3 } = await supabase.from('tasks').delete().eq('id', source_id).eq('user_id', userId)
    if (deleteError3) {
      await supabase.from('events').delete().eq('id', event.id)
      return NextResponse.json({ error: 'Conversion failed: could not delete source' }, { status: 500 })
    }

    const { data: finalEvent } = await supabase
      .from('events')
      .select('*')
      .eq('id', event.id)
      .single()

    result = { type: 'event', data: finalEvent || event }
  }

  // TASK -> ROUTINE
  else if (source_type === 'task' && target_type === 'routine') {
    if (!repeat_pattern) {
      return NextResponse.json({ error: 'repeat_pattern is required for conversion to routine' }, { status: 400 })
    }

    const startTime = source.scheduled_start ? new Date(source.scheduled_start) : new Date()
    const duration = source.time_estimate_minutes || 30
    const endTime = new Date(startTime.getTime() + duration * 60000)
    const startTimeStr = `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`
    const endTimeStr = `${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`

    const { data: routine, error: routineError } = await supabase
      .from('routines')
      .insert({
        user_id: userId,
        title: source.title,
        notes: source.notes,
        start_time: startTimeStr,
        end_time: endTimeStr,
        timezone: 'America/New_York',
        recurrence_rule: repeat_pattern,
        location: source.location,
        visibility: source.visibility,
        privacy: source.privacy,
        reminders: source.reminders,
      })
      .select()
      .single()

    if (routineError || !routine) {
      return NextResponse.json({ error: 'Failed to create routine' }, { status: 500 })
    }

    const { error: deleteError4 } = await supabase.from('tasks').delete().eq('id', source_id).eq('user_id', userId)
    if (deleteError4) {
      await supabase.from('routines').delete().eq('id', routine.id)
      return NextResponse.json({ error: 'Conversion failed: could not delete source' }, { status: 500 })
    }
    result = { type: 'routine', data: routine }
  }

  // ROUTINE -> TASK
  else if (source_type === 'routine' && target_type === 'task') {
    const [startH, startM] = source.start_time.split(':').map(Number)
    const [endH, endM] = source.end_time.split(':').map(Number)
    const durationMin = (endH * 60 + endM) - (startH * 60 + startM)

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert({
        user_id: userId,
        title: source.title,
        notes: source.notes,
        time_estimate_minutes: durationMin > 0 ? durationMin : null,
        location: source.location,
        visibility: source.visibility,
        privacy: source.privacy,
        reminders: source.reminders,
        status: 'backlog',
        board: 'current',
        created_via: originOf(auth),
      })
      .select()
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }

    const { error: deleteError5 } = await supabase.from('routines').delete().eq('id', source_id).eq('user_id', userId)
    if (deleteError5) {
      await supabase.from('tasks').delete().eq('id', task.id)
      return NextResponse.json({ error: 'Conversion failed: could not delete source' }, { status: 500 })
    }
    result = { type: 'task', data: task }
  }

  // ROUTINE -> EVENT
  else if (source_type === 'routine' && target_type === 'event') {
    if (!calendar_id) {
      return NextResponse.json({ error: 'calendar_id is required for conversion to event' }, { status: 400 })
    }

    const { data: cal } = await supabase
      .from('calendars')
      .select('id, google_account_id, google_calendar_id')
      .eq('id', calendar_id)
      .eq('user_id', userId)
      .single()

    if (!cal) {
      return NextResponse.json({ error: 'Calendar not found' }, { status: 404 })
    }

    const now = new Date()
    const [startH, startM] = source.start_time.split(':').map(Number)
    const [endH, endM] = source.end_time.split(':').map(Number)
    const startDate = new Date(now)
    startDate.setHours(startH, startM, 0, 0)
    const endDate = new Date(now)
    endDate.setHours(endH, endM, 0, 0)

    const eventRow: Record<string, unknown> = {
      user_id: userId,
      calendar_id,
      title: source.title,
      notes: source.notes,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      timezone: source.timezone || 'America/New_York',
      location: source.location,
      visibility: source.visibility,
      privacy: source.privacy === 'private' ? 'private' : 'public',
      recurrence_rule: source.recurrence_rule,
      reminders: source.reminders,
      status: 'confirmed',
      sync_status: 'synced',
      google_event_id: cal.google_account_id ? newGoogleEventId() : null,
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert(eventRow)
      .select()
      .single()

    if (eventError || !event) {
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
    }

    try {
      // A local calendar has nothing to push to. The database keeps its events
      // marked synced, so landing in the catch below does no harm.
      if (!cal.google_account_id || !cal.google_calendar_id) {
        throw new Error('Local calendar')
      }
      const googleResult = await createGoogleEvent(
        cal.google_account_id,
        cal.google_calendar_id,
        {
          id: event.google_event_id ?? undefined,
          summary: source.title,
          description: source.notes || undefined,
          start: { dateTime: startDate.toISOString(), timeZone: source.timezone || 'America/New_York' },
          end: { dateTime: endDate.toISOString(), timeZone: source.timezone || 'America/New_York' },
          location: source.location || undefined,
          recurrence: source.recurrence_rule ? googleRecurrence(source.recurrence_rule) : undefined,
        }
      )

      await supabase
        .from('events')
        .update({
          google_event_id: googleResult.id,
          etag: googleResult.etag,
          conferencing_url: googleResult.hangoutLink || null,
        })
        .eq('id', event.id)
    } catch {
      await supabase
        .from('events')
        .update({ sync_status: 'pending_push' })
        .eq('id', event.id)
    }

    const { error: deleteError6 } = await supabase.from('routines').delete().eq('id', source_id).eq('user_id', userId)
    if (deleteError6) {
      await supabase.from('events').delete().eq('id', event.id)
      return NextResponse.json({ error: 'Conversion failed: could not delete source' }, { status: 500 })
    }

    const { data: finalEvent } = await supabase
      .from('events')
      .select('*')
      .eq('id', event.id)
      .single()

    result = { type: 'event', data: finalEvent || event }
  }

  if (!result) {
    return NextResponse.json({ error: 'Invalid conversion' }, { status: 400 })
  }

  return NextResponse.json(result, { status: 201 })
}
