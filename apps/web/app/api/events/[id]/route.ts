import { pushEvent } from '@/lib/google/sync'
import type { CalendarEvent, Calendar } from '@poolendar/types'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../lib/auth/helpers'
import { deleteGoogleEvent } from '../../../../lib/google/calendar'
import { omit } from '../../../../lib/omit'
import { deleteEventQuerySchema, updateEventSchema } from '@poolendar/validators'
import { isValidRecurrenceRule } from '../../../../lib/recurrence'
import { applyScopedDelete, applyScopedEdit, deleteEventSeries } from '../../../../lib/recurrence-edit'

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
  updateFields.sync_status = 'pending_push'

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

  // Every API/browser/background path uses the same revision-aware push.
  const { data: calendar } = await supabase.from('calendars').select('*').eq('id', updatedEvent.calendar_id).single()
  if (calendar?.source === 'google') {
    try { await pushEvent(updatedEvent as CalendarEvent, calendar as Calendar) }
    catch { /* The row remains pending for retry; never overwrite a newer edit. */ }
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

  try {
    await deleteEventSeries(supabase, event)
  } catch (error) {
    const conflict = (error as { code?: string }).code === 'PT409'
    return NextResponse.json({ error: conflict ? 'Event changed; reload before deleting' : 'Failed to delete event' }, { status: conflict ? 409 : 500 })
  }
  // The DB tombstones also retain cleanup if this immediate attempt fails.
  if (event.google_event_id) {
    try { await deleteGoogleEvent(event.calendars.google_account_id, event.calendars.google_calendar_id, event.google_event_id) }
    catch { /* Tombstone retry handles unavailable Google. */ }
  }

  return new NextResponse(null, { status: 204 })
}
