// SERVICE ROLE: Required — public endpoint (no auth). External visitors cancel
// or reschedule bookings using a secret cancel_token without logging in.
//
// GET renders a confirmation page (no mutation — the earlier version mutated on
// GET, which meant link-preview bots and prefetchers silently cancelled real
// bookings). The actual cancellation is a POST. Reschedule is "cancel + go back
// to the booking page to pick a new time" and shares this route via `intent`.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { rateLimitAsync } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'
import {
  notifyHostOfBooking,
  type BookingRecord,
  type BookingLinkRecord,
} from '@/lib/booking/notify'

interface JoinedLink {
  name: string
  slug: string
  location: string | null
  timezone: string
  user_id: string
  google_account_id: string | null
}

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function htmlResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html' } })
}

function normalizeLink(raw: unknown): JoinedLink {
  return (Array.isArray(raw) ? raw[0] : raw) as JoinedLink
}

// ---------------------------------------------------------------------------
// GET → confirmation page (no mutation)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!(await rateLimitAsync(`cancel:${clientIp(request)}`, 20, 60000))) {
    return htmlResponse(resultPage('Too many requests. Please try again later.', true), 429)
  }

  const token = request.nextUrl.searchParams.get('token')
  const intent = request.nextUrl.searchParams.get('intent') === 'reschedule' ? 'reschedule' : 'cancel'
  if (!token || token.length < 10) {
    return htmlResponse(resultPage('Invalid link.', true), 400)
  }

  const supabase = getServiceClient()
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, start_time, booking_links!inner(name, slug, timezone)')
    .eq('cancel_token', token)
    .single()

  if (error || !booking) {
    return htmlResponse(resultPage('Booking not found.', true), 404)
  }
  if (booking.status === 'cancelled') {
    return htmlResponse(resultPage('This booking has already been cancelled.', false), 200)
  }

  const link = normalizeLink(booking.booking_links)
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: link.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(booking.start_time))

  return htmlResponse(confirmPage({ token, intent, linkName: link.name, when }), 200)
}

// ---------------------------------------------------------------------------
// POST → perform the cancellation (and optionally redirect to rebook)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!(await rateLimitAsync(`cancel:${clientIp(request)}`, 20, 60000))) {
    return htmlResponse(resultPage('Too many requests. Please try again later.', true), 429)
  }

  const { token, intent } = await readTokenIntent(request)
  if (!token || token.length < 10) {
    return htmlResponse(resultPage('Invalid link.', true), 400)
  }

  const supabase = getServiceClient()
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      'id, status, start_time, end_time, booker_name, booker_email, booker_notes, cancel_token, google_event_id, booking_links!inner(name, slug, location, timezone, user_id, google_account_id)'
    )
    .eq('cancel_token', token)
    .single()

  if (error || !booking) {
    return htmlResponse(resultPage('Booking not found.', true), 404)
  }

  const link = normalizeLink(booking.booking_links)

  if (booking.status === 'cancelled') {
    if (intent === 'reschedule') {
      return NextResponse.redirect(new URL(`/book/${link.slug}`, request.url), 303)
    }
    return htmlResponse(resultPage('This booking has already been cancelled.', false), 200)
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', booking.id)

  if (updateError) {
    return htmlResponse(resultPage('Failed to cancel booking. Please try again.', true), 500)
  }

  // Best-effort Google event deletion.
  if (booking.google_event_id && link.google_account_id) {
    try {
      const { getGoogleAccessToken, googleCalendarRequest } = await import('@/lib/google/calendar')
      const accessToken = await getGoogleAccessToken(link.google_account_id)
      const { data: calendar } = await supabase
        .from('calendars')
        .select('google_calendar_id')
        .eq('google_account_id', link.google_account_id)
        .eq('user_id', link.user_id)
        .limit(1)
        .single()
      if (calendar) {
        await googleCalendarRequest(
          accessToken,
          `/calendars/${encodeURIComponent(calendar.google_calendar_id)}/events/${encodeURIComponent(booking.google_event_id)}`,
          { method: 'DELETE' }
        )
      }
    } catch {
      // Google deletion failed — booking is still cancelled locally.
    }
  }

  // Notify the host (spec #57a). Never blocks the response.
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
  await notifyHostOfBooking(supabase, bookingRecord, linkRecord, intent === 'reschedule' ? 'rescheduled' : 'cancelled')

  if (intent === 'reschedule') {
    return NextResponse.redirect(new URL(`/book/${link.slug}`, request.url), 303)
  }
  return htmlResponse(resultPage('Your booking has been cancelled.', false), 200)
}

async function readTokenIntent(
  request: NextRequest
): Promise<{ token: string | null; intent: 'cancel' | 'reschedule' }> {
  // Support both a submitted HTML form and a programmatic JSON/query call.
  const qsToken = request.nextUrl.searchParams.get('token')
  const qsIntent = request.nextUrl.searchParams.get('intent')
  const contentType = request.headers.get('content-type') ?? ''

  let token: string | null = qsToken
  let intent: string | null = qsIntent

  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { token?: string; intent?: string }
      token = body.token ?? token
      intent = body.intent ?? intent
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const form = await request.formData()
      token = (form.get('token') as string | null) ?? token
      intent = (form.get('intent') as string | null) ?? intent
    }
  } catch {
    // Fall back to query params.
  }

  return { token, intent: intent === 'reschedule' ? 'reschedule' : 'cancel' }
}

// ---------------------------------------------------------------------------
// Page templates
// ---------------------------------------------------------------------------
function pageShell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking - Meowlendar</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f9fafb;color:#1a1a1a">
<div style="text-align:center;max-width:420px;padding:24px">
${inner}
<p style="margin-top:24px;font-size:13px;color:#999">Meowlendar</p>
</div>
</body>
</html>`
}

function confirmPage(opts: {
  token: string
  intent: 'cancel' | 'reschedule'
  linkName: string
  when: string
}): string {
  const reschedule = opts.intent === 'reschedule'
  const heading = reschedule ? 'Reschedule this booking?' : 'Cancel this booking?'
  const buttonLabel = reschedule ? 'Reschedule' : 'Cancel booking'
  const buttonColor = reschedule ? '#6366f1' : '#ef4444'
  return pageShell(`
<h1 style="font-size:18px;margin:0 0 8px">${heading}</h1>
<p style="font-size:14px;color:#555;margin:0 0 4px">${escapeHtml(opts.linkName)}</p>
<p style="font-size:15px;font-weight:600;margin:0 0 20px">${escapeHtml(opts.when)}</p>
<form method="POST" action="/api/booking/cancel">
  <input type="hidden" name="token" value="${escapeHtml(opts.token)}">
  <input type="hidden" name="intent" value="${opts.intent}">
  <button type="submit" style="display:inline-block;padding:11px 22px;background:${buttonColor};color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer">${buttonLabel}</button>
</form>`)
}

function resultPage(message: string, isError: boolean): string {
  const icon = isError ? '&#10060;' : '&#9989;'
  const color = isError ? '#ef4444' : '#22c55e'
  return pageShell(`
<div style="font-size:48px;margin-bottom:16px">${icon}</div>
<p style="font-size:16px;color:${color};font-weight:600">${escapeHtml(message)}</p>`)
}
