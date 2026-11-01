import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../lib/auth/helpers'
import { updateGoogleEvent, deleteGoogleEvent } from '../../../../lib/google/calendar'
import type { GoogleEventWrite } from '../../../../lib/google/types'
import { omit } from '../../../../lib/omit'
import { deleteEventQuerySchema, updateEventSchema } from '@poolendar/validators'
import { googleRecurrence, isValidRecurrenceRule } from '../../../../lib/recurrence'
import { applyScopedDelete, applyScopedEdit } from '../../../../lib/recurrence-edit'

interface RouteParams {
  params: Promise<{ id: string }>
}

function scopeInputProblem(
  scope: string,
  occurrenceStart: string | undefined,
  dates: string[] | undefined,
): string | null {
  if ((scope === 'single' || scope === 'future') && !occurrenceStart) {
    return `scope '${scope}' needs occurrence_start`
  }
  if (scope === 'custom' && !dates?.length) return "scope 'custom' needs scope_dates"
  return null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error || !event) {
    return NextResponse.json(
      { error: 'Event not found' },
      { status: 404 }
    )
  }

  return NextResponse.json(event)
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const parsed = updateEventSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const input = parsed.data

  // Fetch the existing event to verify ownership and get Google IDs
  const { data: existing, error: fetchError } = await supabase
    .from('events')
    .select('*, calendars!inner(google_account_id, google_calendar_id)')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: 'Event not found' },
      { status: 404 }
    )
  }

  // Build the update object, omitting non-DB fields.
  const dbFields = omit(input, ['conferencing', 'scope', 'scope_dates', 'occurrence_start'])
  const updateFields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(dbFields)) {
    if (value !== undefined) {
      updateFields[key] = value
    }
  }

  updateFields.updated_at = new Date().toISOString()

  if (typeof input.recurrence_rule === 'string' && !isValidRecurrenceRule(input.recurrence_rule)) {
    return NextResponse.json({ error: 'recurrence_rule is not a valid RRULE' }, { status: 422 })
  }

  // Part of a recurring series goes through the scoped path. An unscoped edit of a
  // series is an edit of the whole series, as it always was.
  if (input.scope && existing.recurrence_rule) {
    const scopeProblem = scopeInputProblem(input.scope, input.occurrence_start, input.scope_dates)
    if (scopeProblem) return NextResponse.json({ error: scopeProblem }, { status: 422 })
    try {
      const result = await applyScopedEdit(supabase, existing, {
        scope: input.scope,
        occurrenceStart: input.occurrence_start,
        dates: input.scope_dates,
        patch: updateFields,
      })
      return NextResponse.json(result)
    } catch (err) {
      console.error('[events/PATCH] scoped edit failed:', err)
      return NextResponse.json({ error: 'Failed to update event' }, { status: 500 })
    }
  }

  // Update in Supabase (RLS-scoped; user_id filter is defense-in-depth)
  const { data: updatedEvent, error: updateError } = await supabase
    .from('events')
    .update(updateFields)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (updateError || !updatedEvent) {
    return NextResponse.json(
      { error: 'Failed to update event' },
      { status: 500 }
    )
  }

  // Sync changes to Google Calendar if this event has a Google counterpart
  if (existing.google_event_id) {
    try {
      const calendar = existing.calendars
      const googlePatch: GoogleEventWrite = {}

      if (input.title !== undefined) {
        googlePatch.summary = input.title
      }
      if (input.notes !== undefined) {
        googlePatch.description = input.notes
      }
      if (input.location !== undefined) {
        googlePatch.location = input.location
      }
      if (input.privacy !== undefined) {
        googlePatch.visibility = input.privacy === 'private' ? 'private' : 'public'
      }
      if (input.visibility !== undefined) {
        googlePatch.transparency = input.visibility === 'free' ? 'transparent' : 'opaque'
      }

      const timezone = input.timezone ?? updatedEvent.timezone

      if (input.start_time !== undefined || input.end_time !== undefined) {
        const isAllDay = input.is_all_day ?? updatedEvent.is_all_day
        const startTime = input.start_time ?? updatedEvent.start_time
        const endTime = input.end_time ?? updatedEvent.end_time

        if (isAllDay) {
          googlePatch.start = { date: startTime.split('T')[0], timeZone: timezone }
          googlePatch.end = { date: endTime.split('T')[0], timeZone: timezone }
        } else {
          googlePatch.start = { dateTime: startTime, timeZone: timezone }
          googlePatch.end = { dateTime: endTime, timeZone: timezone }
        }
      }

      if (input.attendees !== undefined) {
        googlePatch.attendees = input.attendees.map((a) => ({
          email: a.email,
          displayName: a.name,
        }))
      }

      if (input.recurrence_rule !== undefined) {
        googlePatch.recurrence = input.recurrence_rule
          ? googleRecurrence(input.recurrence_rule, existing.recurrence_exceptions)
          : []
      }

      if (input.reminders !== undefined) {
        googlePatch.reminders = input.reminders.length > 0
          ? {
              useDefault: false,
              overrides: input.reminders.map((r) => ({
                method: 'popup',
                minutes: r.minutes_before,
              })),
            }
          : { useDefault: true }
      }

      if (Object.keys(googlePatch).length > 0) {
        const googleResult = await updateGoogleEvent(
          calendar.google_account_id as string,
          calendar.google_calendar_id as string,
          existing.google_event_id,
          googlePatch
        )

        if (googleResult?.etag) {
          await supabase
            .from('events')
            .update({ etag: googleResult.etag, sync_status: 'synced' })
            .eq('id', id)
        }
      }
    } catch {
      // Google sync failed -- mark as pending
      await supabase
        .from('events')
        .update({ sync_status: 'pending_push' })
        .eq('id', id)
    }
  }

  // Re-fetch to return the latest state (including any sync_status update)
  const { data: finalEvent } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single()

  return NextResponse.json(finalEvent ?? updatedEvent)
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  const { searchParams } = request.nextUrl
  const parsedQuery = deleteEventQuerySchema.safeParse({
    scope: searchParams.get('scope') ?? undefined,
    occurrence_start: searchParams.get('occurrence_start') ?? undefined,
    scope_dates: searchParams.getAll('scope_dates').length ? searchParams.getAll('scope_dates') : undefined,
  })
  if (!parsedQuery.success) return validationError(parsedQuery.error.issues)
  const deleteOptions = parsedQuery.data

  // Fetch the event to verify ownership and get Google IDs
  const { data: event, error: fetchError } = await supabase
    .from('events')
    .select('*, calendars!inner(google_account_id, google_calendar_id)')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !event) {
    return NextResponse.json(
      { error: 'Event not found' },
      { status: 404 }
    )
  }

  // Part of a series comes out of the master row. It stays, unless nothing is left.
  if (deleteOptions.scope && event.recurrence_rule) {
    const scopeProblem = scopeInputProblem(
      deleteOptions.scope,
      deleteOptions.occurrence_start,
      deleteOptions.scope_dates,
    )
    if (scopeProblem) return NextResponse.json({ error: scopeProblem }, { status: 422 })
    try {
      const { deleteMaster } = await applyScopedDelete(supabase, event, {
        scope: deleteOptions.scope,
        occurrenceStart: deleteOptions.occurrence_start,
        dates: deleteOptions.scope_dates,
      })
      if (!deleteMaster) return new NextResponse(null, { status: 204 })
    } catch (err) {
      console.error('[events/DELETE] scoped delete failed:', err)
      return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 })
    }
  }

  // Delete from Google Calendar if synced
  if (event.google_event_id) {
    try {
      await deleteGoogleEvent(
        event.calendars.google_account_id,
        event.calendars.google_calendar_id,
        event.google_event_id
      )
    } catch {
      // Google delete failed -- proceed with local delete anyway.
      // The event is already gone from the user's perspective.
    }
  }

  // Occurrences pulled out of this series go with it when the whole series goes.
  if (event.recurrence_rule) {
    await supabase.from('events').delete().eq('recurrence_id', id).eq('user_id', userId)
  }

  // Delete from Supabase (RLS-scoped; user_id filter is defense-in-depth)
  const { error: deleteError } = await supabase
    .from('events')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (deleteError) {
    return NextResponse.json(
      { error: 'Failed to delete event' },
      { status: 500 }
    )
  }

  return new NextResponse(null, { status: 204 })
}
