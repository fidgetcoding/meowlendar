// Shared "create the Google Calendar event for a confirmed booking" step, used
// by the book route (auto-confirm) and the approve route. Returns the created
// Google event id, or null when there is no connected calendar / conferencing
// is off / the Google call fails (booking proceeds without a Google event).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createGoogleEvent, deleteGoogleEvent } from '../google/calendar'

interface EventLink {
  user_id: string
  google_account_id: string | null
  conferencing: boolean
  name: string
  location: string | null
  timezone: string
}

interface EventBooking {
  id: string
  booker_name: string
  booker_email: string
  booker_notes: string | null
  start_time: string
  end_time: string
}

export async function createBookingGoogleEvent(
  supabase: SupabaseClient,
  link: EventLink,
  booking: EventBooking
): Promise<string | null> {
  if (!link.google_account_id || !link.conferencing) return null

  try {
    const { data: calendar } = await supabase
      .from('calendars')
      .select('google_calendar_id')
      .eq('google_account_id', link.google_account_id)
      .eq('user_id', link.user_id)
      .limit(1)
      .single()

    if (!calendar) return null

    // Persist a deterministic remote identity before the request. A failed local
    // reservation/link write can never leave an untracked external invitation.
    const remoteId = `mb${booking.id.replace(/-/g, '').toLowerCase()}`
    const { data: reserved, error: reserveError } = await supabase.from('bookings')
      .update({ google_event_id: remoteId, google_account_id: link.google_account_id, google_calendar_id: calendar.google_calendar_id }).eq('id', booking.id).eq('status', 'confirmed')
      .select('id').maybeSingle()
    if (reserveError || !reserved) return null

    try {
      await createGoogleEvent(
      link.google_account_id,
      calendar.google_calendar_id,
      {
        id: remoteId,
        summary: `${link.name} with ${booking.booker_name}`,
        description: booking.booker_notes ?? undefined,
        start: { dateTime: booking.start_time, timeZone: link.timezone },
        end: { dateTime: booking.end_time, timeZone: link.timezone },
        location: link.location ?? undefined,
        attendees: [{ email: booking.booker_email }],
      },
      true
    )
    } catch (error) {
      // Retrying the same reservation cannot create a second event.
      if (!String(error).includes('409')) return null
    }
    const { data: current, error: readError } = await supabase.from('bookings')
      .select('status, google_event_id').eq('id', booking.id).maybeSingle()
    // The remote identity is already durable; a transient read error must not
    // delete a still-confirmed meeting.
    if (readError) return remoteId
    if (current?.status !== 'confirmed' || current.google_event_id !== remoteId) {
      // Cancellation may have been processed before the slow create finished.
      // Queue cleanup again, so a failed compensating request is retried.
      const { error: cleanupError } = await supabase.from('google_event_tombstones').insert({
        user_id: link.user_id, google_account_id: link.google_account_id,
        google_calendar_id: calendar.google_calendar_id, google_event_id: remoteId,
      })
      try { await deleteGoogleEvent(link.google_account_id, calendar.google_calendar_id, remoteId) }
      catch (error) { if (cleanupError) throw error }
      return null
    }
    return remoteId
  } catch {
    return null
  }
}
