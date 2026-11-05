// Booking-side notifications (spec #57a). Three surfaces, all reachable from the
// book / approve / decline / cancel routes:
//   1. Booker confirmation email — HTML + ICS (METHOD:REQUEST) + cancel/reschedule links.
//   2. Booker decline email — polite, no ICS.
//   3. Host notification — through the shared dispatcher (in-app + push + email + Telegram).
//
// RESEND LOG-ONLY MODE: when RESEND_API_KEY is unset (local dev, per the standing
// directive: no real email sends), every email is fully rendered and logged
// (to / subject / whether an ICS is attached) instead of sent. That log line IS
// the local verification artifact.
import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { generateBookingICS } from '../ics'
import { dispatchNotification } from '../notifications/dispatcher'

export interface BookingRecord {
  id: string
  start_time: string
  end_time: string
  booker_name: string
  booker_email: string
  booker_notes: string | null
  cancel_token: string
}

export interface BookingLinkRecord {
  name: string
  slug: string
  location: string | null
  timezone: string
  user_id: string
}

interface HostInfo {
  display_name: string
  email: string
}

function resendKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key || key.toLowerCase() === 'placeholder') return null
  return key
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '')
}

export function cancelUrl(token: string): string {
  return `${appUrl()}/api/booking/cancel?token=${encodeURIComponent(token)}`
}

export function rescheduleUrl(token: string): string {
  return `${appUrl()}/api/booking/cancel?token=${encodeURIComponent(token)}&intent=reschedule`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function formatWhen(startIso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(startIso))
}

async function getHost(supabase: SupabaseClient, userId: string): Promise<HostInfo> {
  const { data } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', userId)
    .single()
  return {
    display_name: (data?.display_name as string) || 'Your host',
    email: (data?.email as string) || 'host@poolendar.com',
  }
}

interface EmailPayload {
  to: string
  subject: string
  html: string
  ics?: string
}

/** Send via Resend, or (no key) log the fully-rendered email and return logged=true. */
async function deliver(payload: EmailPayload): Promise<{ sent: boolean; logged: boolean }> {
  const key = resendKey()
  if (!key) {
    console.log(
      '[booking/notify] EMAIL (log-only, RESEND_API_KEY unset) →',
      JSON.stringify({
        to: payload.to,
        subject: payload.subject,
        has_ics: !!payload.ics,
        ics_bytes: payload.ics ? Buffer.byteLength(payload.ics) : 0,
        html_bytes: Buffer.byteLength(payload.html),
      })
    )
    return { sent: false, logged: true }
  }

  const resend = new Resend(key)
  const from = process.env.RESEND_FROM_EMAIL || 'Meowlendar <noreply@meowlendar.com>'
  const attachments = payload.ics
    ? [{ filename: 'invite.ics', content: Buffer.from(payload.ics).toString('base64') }]
    : undefined
  const { error } = await resend.emails.send({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    attachments,
  })
  if (error) {
    console.error('[booking/notify] Resend send failed:', error)
    return { sent: false, logged: false }
  }
  return { sent: true, logged: false }
}

/**
 * Send the booker their confirmation email with an ICS invite plus cancel and
 * reschedule links. Called on auto-confirm and after host approval.
 */
export async function sendBookingConfirmationEmail(
  supabase: SupabaseClient,
  booking: BookingRecord,
  link: BookingLinkRecord
): Promise<{ sent: boolean; logged: boolean }> {
  const host = await getHost(supabase, link.user_id)
  const ics = generateBookingICS({
    uid: `booking-${booking.id}@poolendar.com`,
    start: new Date(booking.start_time),
    end: new Date(booking.end_time),
    summary: `${link.name} with ${host.display_name}`,
    description: booking.booker_notes ?? undefined,
    location: link.location ?? undefined,
    organizer: { email: host.email, name: host.display_name },
    attendee: { email: booking.booker_email, name: booking.booker_name },
    dtstamp: new Date(),
  })

  const when = formatWhen(booking.start_time, link.timezone)
  const cancel = cancelUrl(booking.cancel_token)
  const reschedule = rescheduleUrl(booking.cancel_token)
  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 8px;font-size:18px">You're booked${host.display_name ? ` with ${escapeHtml(host.display_name)}` : ''}</h2>
  <p style="margin:0 0 4px;font-size:14px;color:#555">${escapeHtml(link.name)}</p>
  <p style="margin:0 0 16px;font-size:15px;font-weight:600">${escapeHtml(when)}</p>
  ${link.location ? `<p style="margin:0 0 16px;font-size:13px;color:#555">Location: ${escapeHtml(link.location)}</p>` : ''}
  <p style="font-size:13px;color:#555">The calendar invite is attached. Need to change plans?</p>
  <p style="margin-top:16px">
    <a href="${escapeHtml(reschedule)}" style="display:inline-block;padding:10px 18px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-size:14px;margin-right:8px">Reschedule</a>
    <a href="${escapeHtml(cancel)}" style="display:inline-block;padding:10px 18px;background:#f3f4f6;color:#1a1a1a;border-radius:6px;text-decoration:none;font-size:14px">Cancel</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">
  <p style="font-size:11px;color:#999;margin:0">Meowlendar</p>
</body></html>`.trim()

  return deliver({
    to: booking.booker_email,
    subject: `Confirmed: ${link.name}, ${when}`,
    html,
    ics,
  })
}

/** Send the booker a polite decline email when the host declines the request. */
export async function sendBookingDeclinedEmail(
  supabase: SupabaseClient,
  booking: BookingRecord,
  link: BookingLinkRecord
): Promise<{ sent: boolean; logged: boolean }> {
  const host = await getHost(supabase, link.user_id)
  const when = formatWhen(booking.start_time, link.timezone)
  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 8px;font-size:18px">Your booking request couldn't be confirmed</h2>
  <p style="margin:0 0 12px;font-size:14px;color:#555">Unfortunately ${escapeHtml(host.display_name)} isn't able to meet for <strong>${escapeHtml(link.name)}</strong> on ${escapeHtml(when)}.</p>
  <p style="margin:0 0 12px;font-size:14px;color:#555">Please feel free to pick another time that works for you.</p>
  <p style="margin-top:16px">
    <a href="${escapeHtml(`${appUrl()}/book/${link.slug}`)}" style="display:inline-block;padding:10px 18px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-size:14px">Find another time</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">
  <p style="font-size:11px;color:#999;margin:0">Meowlendar</p>
</body></html>`.trim()

  return deliver({
    to: booking.booker_email,
    subject: `Update on your ${link.name} request`,
    html,
  })
}

type HostBookingEvent = 'new' | 'pending' | 'cancelled' | 'rescheduled'

/**
 * Notify the host through the shared dispatcher (respects their per-channel
 * notification settings). Used for new bookings, pending approvals, and
 * cancellations. Never throws — notification failure must not fail the booking.
 */
export async function notifyHostOfBooking(
  supabase: SupabaseClient,
  booking: BookingRecord,
  link: BookingLinkRecord,
  kind: HostBookingEvent
): Promise<void> {
  const when = formatWhen(booking.start_time, link.timezone)
  const titles: Record<HostBookingEvent, string> = {
    new: `New booking: ${link.name}`,
    pending: `Approval needed: ${link.name}`,
    cancelled: `Booking cancelled: ${link.name}`,
    rescheduled: `Booking rescheduled: ${link.name}`,
  }
  try {
    const results = await dispatchNotification(supabase, link.user_id, {
      title: titles[kind],
      body: `${booking.booker_name}, ${when}`,
      event: 'booking',
      url: '/',
      data: {
        booking_id: booking.id,
        booker_email: booking.booker_email,
        kind,
      },
    })
    // Durable, greppable proof the host-notification path fired and which channels
    // were attempted (per the host's configured settings). In-app is a realtime
    // broadcast (no persisted row by design — PRODUCT #62 "toast/badge").
    console.log(
      `[booking/notify] host notified kind=${kind} booking=${booking.id} channels=` +
        JSON.stringify(results.map((r) => `${r.channel}:${r.success ? 'ok' : 'skip'}`))
    )
  } catch (err) {
    console.error('[booking/notify] host notification failed:', err)
  }
}
