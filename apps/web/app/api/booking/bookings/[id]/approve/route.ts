// Host approves a pending booking (spec #53, #57a). Session or API-key auth.
// Transition: pending → confirmed. On approval the Google event is created (this
// is the FIRST time it happens for a requires_approval link), the booker gets
// their confirmation email + ICS, and the host gets a notification.
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../../../../lib/auth/helpers'
import { createBookingGoogleEvent } from '@/lib/booking/google-event'
import {
  sendBookingConfirmationEmail,
  notifyHostOfBooking,
  type BookingRecord,
  type BookingLinkRecord,
} from '@/lib/booking/notify'

type RouteParams = { params: Promise<{ id: string }> }

interface JoinedLink {
  user_id: string
  name: string
  slug: string
  location: string | null
  timezone: string
  google_account_id: string | null
  conferencing: boolean
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      'id, status, booker_name, booker_email, booker_notes, start_time, end_time, cancel_token, google_event_id, booking_links!inner(user_id, name, slug, location, timezone, google_account_id, conferencing)'
    )
    .eq('id', id)
    .single()

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const linkRaw = booking.booking_links as unknown as JoinedLink | JoinedLink[]
  const link = Array.isArray(linkRaw) ? linkRaw[0]! : linkRaw

  if (link.user_id !== userId) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (booking.status !== 'pending') {
    return NextResponse.json(
      { error: `Cannot approve a ${booking.status} booking` },
      { status: 409 }
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: 'Failed to approve booking' }, { status: 500 })
  }

  updated.google_event_id = await createBookingGoogleEvent(supabase, link, updated)

  const bookingRecord: BookingRecord = {
    id: updated.id,
    start_time: updated.start_time,
    end_time: updated.end_time,
    booker_name: updated.booker_name,
    booker_email: updated.booker_email,
    booker_notes: updated.booker_notes,
    cancel_token: updated.cancel_token,
  }
  const linkRecord: BookingLinkRecord = {
    name: link.name,
    slug: link.slug,
    location: link.location,
    timezone: link.timezone,
    user_id: link.user_id,
  }

  await sendBookingConfirmationEmail(supabase, bookingRecord, linkRecord)
  await notifyHostOfBooking(supabase, bookingRecord, linkRecord, 'new')

  return NextResponse.json(updated)
}
