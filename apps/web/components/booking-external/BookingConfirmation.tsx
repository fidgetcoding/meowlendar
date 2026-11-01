'use client'

import { format, parseISO } from 'date-fns'
import { Check, Calendar, ExternalLink } from 'lucide-react'

interface BookingConfirmationProps {
  startTime: string
  endTime: string
  hostName: string
  meetingTitle: string
  cancelToken: string
  timeFormat: '12h' | '24h'
  status?: 'confirmed' | 'pending'
}

export function BookingConfirmation({
  startTime,
  endTime,
  hostName,
  meetingTitle,
  cancelToken,
  timeFormat,
  status = 'confirmed',
}: BookingConfirmationProps) {
  const start = parseISO(startTime)
  const end = parseISO(endTime)
  const pending = status === 'pending'

  const formatStr = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'

  // Google Calendar "add to calendar" URL
  const gcalUrl = new URL('https://www.google.com/calendar/render')
  gcalUrl.searchParams.set('action', 'TEMPLATE')
  gcalUrl.searchParams.set('text', meetingTitle)
  gcalUrl.searchParams.set(
    'dates',
    `${format(start, "yyyyMMdd'T'HHmmss")}/${format(end, "yyyyMMdd'T'HHmmss")}`
  )
  gcalUrl.searchParams.set('details', `Meeting with ${hostName}`)

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: pending ? 'var(--accent)' : 'var(--success)', opacity: 0.2 }}
      />
      <div className="-mt-14 mb-2 flex h-16 w-16 items-center justify-center">
        {pending ? (
          <Calendar className="h-8 w-8" style={{ color: 'var(--accent)' }} />
        ) : (
          <Check className="h-8 w-8 text-[var(--success)]" />
        )}
      </div>

      <h2 className="mb-2 text-xl font-bold text-[var(--fg)]">
        {pending ? 'Request Sent' : 'Booking Confirmed'}
      </h2>

      <p className="mb-6 text-sm text-[var(--muted)]">
        {pending
          ? `Your request was sent to ${hostName}. You'll get a confirmation email once it's approved.`
          : `You are booked with ${hostName}`}
      </p>

      <div className="mb-6 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
        <p className="font-semibold text-[var(--fg)]">{meetingTitle}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {format(start, 'EEEE, MMMM d, yyyy')}
        </p>
        <p className="text-sm text-[var(--muted)]">
          {format(start, formatStr)} - {format(end, formatStr)}
        </p>
      </div>

      <div className="flex w-full flex-col gap-2">
        {!pending && (
          <a
            href={gcalUrl.toString()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Calendar className="h-4 w-4" />
            Add to Google Calendar
            <ExternalLink className="h-3 w-3 text-[var(--muted)]" />
          </a>
        )}

        <a
          href={`/api/booking/cancel?token=${cancelToken}`}
          className="text-xs text-[var(--muted)] hover:text-[var(--destructive)] hover:underline"
        >
          {pending ? 'Withdraw this request' : 'Cancel this booking'}
        </a>
      </div>
    </div>
  )
}
