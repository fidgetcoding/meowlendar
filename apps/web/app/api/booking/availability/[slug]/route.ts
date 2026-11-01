// SERVICE ROLE: Required — public endpoint (no auth). External visitors query
// availability by slug without logging in, so there is no user session.  The
// service client bypasses RLS to read booking_links, profiles, bookings, and
// events on behalf of the link owner.
//
// Availability is computed against the host's SHARED pool (spec #56): every
// booking across ALL of the host's links, the host's calendar events, and —
// when a Google account is connected — Google freeBusy. Any DB read failure
// fails CLOSED (503), never "everything free".
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { rateLimitAsync } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'
import { classifyHost } from '@/lib/hosts'
import {
  timeInTimezoneToUtc,
  addDaysStr,
  computeBlockedIntervals,
  computeAvailableSlots,
  type AvailabilityWindow,
  type BusyBooking,
} from '@/lib/booking/availability'
import { getGoogleBusyPeriods } from '@/lib/google/freebusy'

type RouteParams = { params: Promise<{ slug: string }> }

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

async function resolveSlug(supabase: ReturnType<typeof getServiceClient>, slug: string) {
  const { data, error } = await supabase
    .from('booking_links')
    .select('*, profiles!inner(id, username, display_name, avatar_url, settings)')
    .eq('slug', slug)
    .eq('is_public', true)
    .limit(1)
    .single()

  if (error || !data) return null
  return data
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const supabase = getServiceClient()
  const { slug } = await params

  const ip = clientIp(request)
  if (!(await rateLimitAsync(`booking-avail-ip:${ip}`, 120, 60000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const link = await resolveSlug(supabase, slug)
  if (!link) {
    return NextResponse.json({ error: 'Booking link not found' }, { status: 404 })
  }

  // On a booking subdomain the link has to belong to that subdomain's owner.
  const host = classifyHost(request.headers.get('host'))
  const owner = (link.profiles as { username?: string }).username
  if (host.kind === 'booking' && owner !== host.username) {
    return NextResponse.json({ error: 'Booking link not found' }, { status: 404 })
  }

  // Keyed on the link id, after the lookup, so unknown slugs can't create rows.
  if (!(await rateLimitAsync(`booking-avail:${ip}:${link.id}`, 30, 60000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = request.nextUrl
  const info = searchParams.get('info')

  if (info === 'true') {
    const profile = link.profiles as {
      id: string
      display_name: string | null
      avatar_url: string | null
      settings: Record<string, unknown> | null
    }
    const settings = (profile.settings ?? {}) as Record<string, unknown>

    // Named fields only. This response is public, so it must not carry user_id,
    // google_account_id, or anything else the booking page doesn't render.
    return NextResponse.json({
      booking_link: {
        slug: link.slug,
        name: link.name,
        duration_minutes: link.duration_minutes,
        availability: link.availability,
        timezone: link.timezone,
        location: link.location,
        notes: link.notes,
        requires_approval: link.requires_approval,
      },
      host: {
        display_name: profile.display_name || 'Host',
        avatar_url: profile.avatar_url,
        booking_page_title: (settings.booking_page_title as string) ?? null,
        booking_page_brand_color: (settings.booking_page_brand_color as string) ?? null,
        booking_page_logo_url: (settings.booking_page_logo_url as string) ?? null,
      },
    })
  }

  const dateParam = searchParams.get('date')
  const startParam = searchParams.get('start')
  const endParam = searchParams.get('end')
  const timezoneParam = searchParams.get('timezone')

  const startDate = dateParam ?? startParam
  const endDate = dateParam ?? endParam

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: 'Missing required query parameters: date (or start+end)' },
      { status: 400 }
    )
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json(
      { error: 'Date parameters must be in YYYY-MM-DD format' },
      { status: 400 }
    )
  }

  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).getTime()
  const MAX_RANGE_DAYS = 90
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs || (endMs - startMs) > MAX_RANGE_DAYS * 86_400_000) {
    return NextResponse.json(
      { error: `Date range must not exceed ${MAX_RANGE_DAYS} days` },
      { status: 400 }
    )
  }

  const timezone: string = timezoneParam ?? link.timezone
  const durationMinutes: number = link.duration_minutes
  const availability: AvailabilityWindow[] = Array.isArray(link.availability) ? link.availability : []

  const rangeStartUtc = timeInTimezoneToUtc(startDate, '00:00', timezone)
  const rangeEndUtc = timeInTimezoneToUtc(addDaysStr(endDate, 1), '00:00', timezone)

  // --- Shared pool: every booking across ALL of the host's links ---
  // Fetch the host's links (id + their own buffer) so each booking is padded by
  // the buffer of the link it was made under.
  const { data: hostLinks, error: linksError } = await supabase
    .from('booking_links')
    .select('id, buffer_minutes')
    .eq('user_id', link.user_id)

  if (linksError || !hostLinks) {
    // Fail CLOSED — never advertise availability we couldn't verify.
    return NextResponse.json({ error: 'Availability temporarily unavailable' }, { status: 503 })
  }

  const bufferByLink = new Map<string, number>(
    hostLinks.map((l) => [l.id as string, (l.buffer_minutes as number) ?? 0])
  )
  const linkIds = hostLinks.map((l) => l.id as string)

  const { data: existingBookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('booking_link_id, start_time, end_time')
    .in('booking_link_id', linkIds)
    .in('status', ['confirmed', 'pending'])
    .lt('start_time', rangeEndUtc.toISOString())
    .gt('end_time', rangeStartUtc.toISOString())

  if (bookingsError) {
    return NextResponse.json({ error: 'Availability temporarily unavailable' }, { status: 503 })
  }

  const { data: existingEvents, error: eventsError } = await supabase
    .from('events')
    .select('start_time, end_time')
    .eq('user_id', link.user_id)
    .neq('status', 'cancelled')
    .lt('start_time', rangeEndUtc.toISOString())
    .gt('end_time', rangeStartUtc.toISOString())

  if (eventsError) {
    return NextResponse.json({ error: 'Availability temporarily unavailable' }, { status: 503 })
  }

  // Google freeBusy — only when an account is connected; degrades to [] otherwise.
  const googleBusy = await getGoogleBusyPeriods({
    googleAccountId: link.google_account_id,
    timeMin: rangeStartUtc,
    timeMax: rangeEndUtc,
  })

  const bookings: BusyBooking[] = (existingBookings ?? []).map((b) => ({
    start_time: b.start_time,
    end_time: b.end_time,
    buffer_minutes: bufferByLink.get(b.booking_link_id) ?? 0,
  }))

  const blocked = computeBlockedIntervals({
    bookings,
    events: existingEvents ?? [],
    googleBusy,
    currentBufferMinutes: link.buffer_minutes,
  })

  const allSlots = computeAvailableSlots({
    availability,
    startDate,
    endDate,
    timezone,
    durationMinutes,
    now: new Date(),
    minimumNoticeHours: link.minimum_notice_hours,
    blocked,
  })

  if (dateParam) {
    return NextResponse.json({ slots: allSlots })
  }

  return NextResponse.json(allSlots)
}
