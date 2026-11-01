// SERVICE ROLE: Required — public endpoint (no auth). External visitors book
// slots by slug without logging in.  The service client bypasses RLS to read
// the booking_link + calendars and to insert bookings/Google events on behalf
// of the link owner.
//
// The conflict check runs against the host's SHARED pool (spec #56) and fails
// CLOSED — if we can't verify the slot is free, we refuse the booking.
// requires_approval links land as 'pending': no Google event, no booker
// confirmation until the host approves (spec #53, #57a).
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { bookSlotSchema } from '@poolendar/validators'
import { rateLimitAsync } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'
import { classifyHost } from '@/lib/hosts'
import {
  computeBlockedIntervals,
  hasConflict,
  type AvailabilityWindow,
  type BusyBooking,
} from '@/lib/booking/availability'
import { getGoogleBusyPeriods } from '@/lib/google/freebusy'
import {
  sendBookingConfirmationEmail,
  notifyHostOfBooking,
  type BookingRecord,
  type BookingLinkRecord,
} from '@/lib/booking/notify'
import { createBookingGoogleEvent } from '@/lib/booking/google-event'

type RouteParams = { params: Promise<{ slug: string }> }

const HOUR_MS = 60 * 60 * 1000
const BOOKINGS_PER_LINK_PER_HOUR = 60
const BOOKINGS_PER_EMAIL_PER_HOUR = 10

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

function getDayOfWeek(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }).toLowerCase()
}

function timeToMinutes(time: string): number {
  const parts = time.split(':').map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

function getTimeInTimezone(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  })
}

function isSlotWithinAvailability(
  startTime: Date,
  endTime: Date,
  availability: AvailabilityWindow[],
  timezone: string
): boolean {
  const dayOfWeek = getDayOfWeek(startTime, timezone)
  const windows = availability.filter((w) => w.day === dayOfWeek)
  if (windows.length === 0) return false

  const slotStartMinutes = timeToMinutes(getTimeInTimezone(startTime, timezone))
  const slotEndMinutes = timeToMinutes(getTimeInTimezone(endTime, timezone))

  return windows.some((w) => {
    const windowStart = timeToMinutes(w.start)
    const windowEnd = timeToMinutes(w.end)
    return slotStartMinutes >= windowStart && slotEndMinutes <= windowEnd
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = getServiceClient()
  const { slug } = await params

  const ip = clientIp(request)
  if (!(await rateLimitAsync(`book-ip:${ip}`, 30, 60000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { data: link, error: linkError } = await supabase
    .from('booking_links')
    .select('*, profiles!inner(username)')
    .eq('slug', slug)
    .eq('is_public', true)
    .limit(1)
    .single()

  if (linkError || !link) {
    return NextResponse.json({ error: 'Booking link not found' }, { status: 404 })
  }

  // On a booking subdomain the link has to belong to that subdomain's owner.
  const host = classifyHost(request.headers.get('host'))
  const owner = (link.profiles as { username?: string }).username
  if (host.kind === 'booking' && owner !== host.username) {
    return NextResponse.json({ error: 'Booking link not found' }, { status: 404 })
  }

  // Keyed on the link id, after the lookup, so unknown slugs can't create rows.
  if (
    !(await rateLimitAsync(`book:${ip}:${link.id}`, 5, 60000)) ||
    !(await rateLimitAsync(`book-link:${link.id}`, BOOKINGS_PER_LINK_PER_HOUR, HOUR_MS))
  ) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bookSlotSchema.safeParse(body)
  if (!parsed.success) {
    const details: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_root'
      if (!details[key]) details[key] = []
      details[key]!.push(issue.message)
    }
    return NextResponse.json({ error: 'Validation error', details }, { status: 400 })
  }

  const input = parsed.data

  // Each booking emails the address supplied, so cap it per recipient. Hashed so
  // the counter table doesn't collect booker addresses.
  const emailKey = createHash('sha256').update(input.booker_email.toLowerCase()).digest('hex')
  if (!(await rateLimitAsync(`book-email:${emailKey}`, BOOKINGS_PER_EMAIL_PER_HOUR, HOUR_MS))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const startTime = new Date(input.start_time)
  const endTime = new Date(startTime.getTime() + link.duration_minutes * 60 * 1000)
  const now = new Date()

  if (startTime <= now) {
    return NextResponse.json({ error: 'Selected time is in the past' }, { status: 409 })
  }

  if (link.minimum_notice_hours > 0) {
    const minimumStart = new Date(now.getTime() + link.minimum_notice_hours * 60 * 60 * 1000)
    if (startTime < minimumStart) {
      return NextResponse.json(
        { error: `Bookings require at least ${link.minimum_notice_hours} hours notice` },
        { status: 409 }
      )
    }
  }

  const availability: AvailabilityWindow[] = Array.isArray(link.availability) ? link.availability : []
  if (!isSlotWithinAvailability(startTime, endTime, availability, link.timezone)) {
    return NextResponse.json(
      { error: 'Selected time slot is outside available hours' },
      { status: 409 }
    )
  }

  // --- Shared-pool conflict check (#56), fail CLOSED ---
  const bufferMs = link.buffer_minutes * 60 * 1000
  const windowStart = new Date(startTime.getTime() - bufferMs).toISOString()
  const windowEnd = new Date(endTime.getTime() + bufferMs).toISOString()

  const { data: hostLinks, error: linksError } = await supabase
    .from('booking_links')
    .select('id, buffer_minutes')
    .eq('user_id', link.user_id)

  if (linksError || !hostLinks) {
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }

  const bufferByLink = new Map<string, number>(
    hostLinks.map((l) => [l.id as string, (l.buffer_minutes as number) ?? 0])
  )
  const linkIds = hostLinks.map((l) => l.id as string)

  const { data: poolBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('booking_link_id, start_time, end_time')
    .in('booking_link_id', linkIds)
    .in('status', ['confirmed', 'pending'])
    .lt('start_time', windowEnd)
    .gt('end_time', windowStart)

  if (bookingsError) {
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }

  const { data: poolEvents, error: eventsError } = await supabase
    .from('events')
    .select('start_time, end_time')
    .eq('user_id', link.user_id)
    .neq('status', 'cancelled')
    .lt('start_time', windowEnd)
    .gt('end_time', windowStart)

  if (eventsError) {
    return NextResponse.json({ error: 'Failed to check calendar availability' }, { status: 500 })
  }

  const googleBusy = await getGoogleBusyPeriods({
    googleAccountId: link.google_account_id,
    timeMin: new Date(windowStart),
    timeMax: new Date(windowEnd),
  })

  const busyBookings: BusyBooking[] = (poolBookings ?? []).map((b) => ({
    start_time: b.start_time,
    end_time: b.end_time,
    buffer_minutes: bufferByLink.get(b.booking_link_id) ?? 0,
  }))

  const blocked = computeBlockedIntervals({
    bookings: busyBookings,
    events: poolEvents ?? [],
    googleBusy,
    currentBufferMinutes: link.buffer_minutes,
  })

  if (hasConflict(startTime.getTime(), endTime.getTime(), blocked)) {
    return NextResponse.json(
      { error: 'Selected time slot is no longer available' },
      { status: 409 }
    )
  }

  const cancelToken = crypto.randomUUID()
  const status = link.requires_approval ? 'pending' : 'confirmed'

  const bookingRow = {
    booking_link_id: link.id,
    booker_name: input.booker_name,
    booker_email: input.booker_email,
    booker_notes: input.booker_notes ?? null,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    status,
    cancel_token: cancelToken,
    google_event_id: null as string | null,
  }

  // Google event + booker invite happen ONLY on immediate confirmation. For
  // requires_approval links, nothing external happens until the host approves.
  if (status === 'confirmed') {
    bookingRow.google_event_id = await createBookingGoogleEvent(supabase, link, {
      booker_name: input.booker_name,
      booker_email: input.booker_email,
      booker_notes: input.booker_notes ?? null,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    })
  }

  const { data: booking, error: insertError } = await supabase
    .from('bookings')
    .insert(bookingRow)
    .select()
    .single()

  if (insertError) {
    if (insertError.code === '23P01') {
      return NextResponse.json({ error: 'Time slot no longer available' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }

  // Notifications (never block the booking response).
  const bookingRecord: BookingRecord = {
    id: booking.id,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booker_name: booking.booker_name,
    booker_email: booking.booker_email,
    booker_notes: booking.booker_notes,
    cancel_token: booking.cancel_token,
  }
  const linkRecord: BookingLinkRecord = {
    name: link.name,
    slug: link.slug,
    location: link.location,
    timezone: link.timezone,
    user_id: link.user_id,
  }

  if (status === 'confirmed') {
    await sendBookingConfirmationEmail(supabase, bookingRecord, linkRecord)
    await notifyHostOfBooking(supabase, bookingRecord, linkRecord, 'new')
  } else {
    await notifyHostOfBooking(supabase, bookingRecord, linkRecord, 'pending')
  }

  return NextResponse.json({
    id: booking.id,
    start_time: booking.start_time,
    end_time: booking.end_time,
    status: booking.status,
    cancel_token: booking.cancel_token,
  }, { status: 201 })
}
