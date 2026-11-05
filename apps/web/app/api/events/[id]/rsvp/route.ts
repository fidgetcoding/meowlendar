import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../../lib/auth/helpers'
import { rsvpSchema } from '@poolendar/validators'
import type { EventAttendee } from '@poolendar/types'
import { NotAGuestError, respondToGoogleEvent } from '@/lib/google/calendar'
import { mapGoogleEventToLocal } from '@/lib/google/sync'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * Answers an invitation for one copy of an event. On a Google calendar the reply goes
 * to Google as that calendar's account, and the copy takes Google's guest list back.
 * Anything Google refuses comes back as an error, never as a quiet success.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const parsed = rsvpSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }
  const { response } = parsed.data

  // Verify the event exists and the user has access to it
  const { data: event, error: fetchError } = await supabase
    .from('events')
    .select('id, calendar_id, google_event_id, attendees')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !event) {
    return NextResponse.json(
      { error: 'Event not found' },
      { status: 404 }
    )
  }

  const { data: calendar } = await supabase
    .from('calendars')
    .select('id, source, google_account_id, google_calendar_id')
    .eq('id', event.calendar_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (calendar?.source === 'google' && calendar.google_account_id && calendar.google_calendar_id && event.google_event_id) {
    const { data: account } = await supabase
      .from('google_accounts')
      .select('email')
      .eq('id', calendar.google_account_id)
      .maybeSingle()

    let google
    try {
      google = await respondToGoogleEvent(
        calendar.google_account_id,
        calendar.google_calendar_id,
        event.google_event_id,
        account?.email ?? null,
        response
      )
    } catch (err) {
      if (err instanceof NotAGuestError) {
        return NextResponse.json({ error: 'This account is not a guest on the event' }, { status: 422 })
      }
      console.error('[events/rsvp] Google reply failed:', err)
      return NextResponse.json({ error: "Couldn't send your reply to Google. Try again." }, { status: 502 })
    }

    const { data: updatedEvent, error: updateError } = await supabase
      .from('events')
      .update({
        attendees: mapGoogleEventToLocal(google, calendar.id, userId).attendees,
        etag: google.etag ?? null,
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError || !updatedEvent) {
      return NextResponse.json(
        { error: 'Your reply reached Google but could not be saved here. Resync to see it.' },
        { status: 500 }
      )
    }
    return NextResponse.json(updatedEvent)
  }

  // A local calendar has no one to tell: the answer is kept here. The caller's email
  // comes from their profile; auth.getUser() is null for API-key callers.
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single()
  const userEmail = profile?.email?.toLowerCase()

  const attendees: EventAttendee[] = Array.isArray(event.attendees) ? event.attendees : []

  let matched = false
  const updatedAttendees = attendees.map((a) => {
    if (a.email?.toLowerCase() === userEmail) {
      matched = true
      return { ...a, response_status: response }
    }
    return a
  })

  if (!matched && userEmail) {
    updatedAttendees.push({ email: userEmail, response_status: response })
  }

  const { data: updatedEvent, error: updateError } = await supabase
    .from('events')
    .update({
      attendees: updatedAttendees,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (updateError || !updatedEvent) {
    return NextResponse.json(
      { error: 'Failed to update RSVP' },
      { status: 500 }
    )
  }

  return NextResponse.json(updatedEvent)
}
