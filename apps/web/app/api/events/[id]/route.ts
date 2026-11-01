import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../lib/auth/helpers'
import { updateGoogleEvent, deleteGoogleEvent } from '../../../../lib/google/calendar'
import type { GoogleEventWrite } from '../../../../lib/google/types'
import { omit } from '../../../../lib/omit'
import { updateEventSchema } from '@poolendar/validators'

interface RouteParams {
  params: Promise<{ id: string }>
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

  // Build the update object, omitting non-DB fields. The recurrence scope is
  // accepted but not applied yet.
  // TODO: implement occurrence-level edits when recurrence_id splitting is built
  const dbFields = omit(input, ['conferencing', 'scope', 'scope_dates'])
  const updateFields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(dbFields)) {
    if (value !== undefined) {
      updateFields[key] = value
    }
  }

  updateFields.updated_at = new Date().toISOString()

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
          ? [input.recurrence_rule]
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
          calendar.google_account_id,
          calendar.google_calendar_id,
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

  // A request body's recurrence scope is ignored for now: DELETE always removes
  // the whole event.
  // TODO: implement occurrence-level deletes when recurrence_id splitting is built

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
