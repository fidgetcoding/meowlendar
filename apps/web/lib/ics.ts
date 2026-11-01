// Pure RFC 5545 (iCalendar) generator for booking invites. No I/O, no dates
// beyond the ones handed in — so it unit-tests deterministically. The output is
// a METHOD:REQUEST VCALENDAR carrying a single VEVENT (organizer = host,
// attendee = booker) suitable for attaching to a confirmation email.

export interface ICSAttendee {
  email: string
  name?: string
}

export interface ICSEventInput {
  uid: string
  start: Date
  end: Date
  summary: string
  description?: string
  location?: string
  organizer: ICSAttendee
  attendee: ICSAttendee
  /** Bumped on reschedule so calendar clients supersede the prior copy. */
  sequence?: number
  /** CONFIRMED (default) or CANCELLED for a cancellation notice. */
  status?: 'CONFIRMED' | 'CANCELLED'
  /** Timestamp for DTSTAMP; defaults to `start`. Injected for deterministic tests. */
  dtstamp?: Date
}

/** Escape a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newlines). */
export function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Format a Date as a UTC iCalendar timestamp: YYYYMMDDTHHMMSSZ. */
export function formatICSDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/**
 * Fold a content line at 75 octets per RFC 5545 §3.1. Continuation lines start
 * with a single space. Folding operates on UTF-8 byte length, not JS chars, so
 * multi-byte content never splits mid-octet-run past the limit.
 */
export function foldICSLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let currentBytes = 0
  let first = true

  for (const char of line) {
    const charBytes = encoder.encode(char).length
    // Continuation lines carry a leading space, so their content budget is 74.
    const limit = first ? 75 : 74
    if (currentBytes + charBytes > limit) {
      out.push(first ? current : ` ${current}`)
      first = false
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += charBytes
  }
  if (current) out.push(first ? current : ` ${current}`)
  return out.join('\r\n')
}

function attendeeValue(prefix: string, params: string, a: ICSAttendee): string {
  // Line breaks would start a new ICS property, so they go too.
  const cn = a.name ? `;CN=${a.name.replace(/[;,:"\r\n]/g, ' ')}` : ''
  return `${prefix}${cn}${params}:mailto:${a.email.replace(/[\r\n]/g, '')}`
}

/**
 * Build a complete VCALENDAR string for a booking invite. Lines are CRLF-joined
 * and folded. METHOD:REQUEST marks it as an invitation so mail clients surface
 * accept/decline.
 */
export function generateBookingICS(input: ICSEventInput): string {
  const status = input.status ?? 'CONFIRMED'
  const method = status === 'CANCELLED' ? 'CANCEL' : 'REQUEST'
  const stamp = input.dtstamp ?? input.start

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meowlendar//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${formatICSDate(stamp)}`,
    `DTSTART:${formatICSDate(input.start)}`,
    `DTEND:${formatICSDate(input.end)}`,
    `SUMMARY:${escapeICSText(input.summary)}`,
  ]

  if (input.description) {
    lines.push(`DESCRIPTION:${escapeICSText(input.description)}`)
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeICSText(input.location)}`)
  }

  lines.push(attendeeValue('ORGANIZER', '', input.organizer))
  lines.push(
    attendeeValue(
      'ATTENDEE',
      ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE',
      input.attendee
    )
  )
  lines.push(`SEQUENCE:${input.sequence ?? 0}`)
  lines.push(`STATUS:${status}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldICSLine).join('\r\n')
}
