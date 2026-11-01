'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import {
  format,
  addDays,
  startOfDay,
} from 'date-fns'
import { Clock, Globe } from 'lucide-react'
import { BookingCalendar } from '@/components/booking-external/BookingCalendar'
import { TimeSlotGrid } from '@/components/booking-external/TimeSlotGrid'
import { BookingForm } from '@/components/booking-external/BookingForm'
import { BookingConfirmation } from '@/components/booking-external/BookingConfirmation'
import type { BookingLink, AvailabilitySlot } from '@poolendar/types'

type BookingStep = 'loading' | 'date' | 'time' | 'form' | 'confirmed' | 'error'

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
]

interface BookingResult {
  id: string
  start_time: string
  end_time: string
  cancel_token: string
  status?: 'confirmed' | 'pending'
}

export default function BookingPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  const [step, setStep] = useState<BookingStep>('loading')
  const [bookingLink, setBookingLink] = useState<BookingLink | null>(null)
  const [hostProfile, setHostProfile] = useState<{
    display_name: string
    avatar_url: string | null
    booking_page_title: string | null
    booking_page_brand_color: string | null
    booking_page_logo_url: string | null
  } | null>(null)
  const [availableDates, setAvailableDates] = useState<Date[]>([])
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null)
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('12h')
  const [detectedTimezone, setDetectedTimezone] = useState('America/New_York')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Detect visitor timezone
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      setDetectedTimezone(tz)
    } catch {
      // Fallback already set
    }
  }, [])

  // Load booking link data
  useEffect(() => {
    async function loadBookingLink() {
      try {
        // Get the username from the subdomain (set by middleware)
        // For dev, fall back to query string or just fetch by slug
        const res = await fetch(`/api/booking/availability/${slug}?info=true`)

        if (!res.ok) {
          setErrorMessage(
            res.status === 404
              ? 'This booking page does not exist.'
              : 'Something went wrong loading this page.'
          )
          setStep('error')
          return
        }

        const data = await res.json()
        setBookingLink(data.booking_link)
        setHostProfile(data.host)

        // Generate available dates for the next 60 days based on availability pattern.
        // Defensive: a link's availability must be an array of {day,start,end}. Older
        // rows (and the pre-fix create path) could persist `{}` — coerce to [] so the
        // page renders an empty state instead of crashing on `.map`.
        const dates: Date[] = []
        const today = startOfDay(new Date())
        const availability = Array.isArray(data.booking_link.availability)
          ? data.booking_link.availability
          : []
        const dayMap: Record<string, number> = {
          sunday: 0,
          monday: 1,
          tuesday: 2,
          wednesday: 3,
          thursday: 4,
          friday: 5,
          saturday: 6,
        }

        const availableDaysOfWeek = new Set(
          availability.map((a: { day: string }) => dayMap[a.day])
        )

        for (let i = 0; i < 60; i++) {
          const date = addDays(today, i)
          if (availableDaysOfWeek.has(date.getDay())) {
            dates.push(date)
          }
        }

        setAvailableDates(dates)
        setStep('date')
      } catch {
        setErrorMessage('Failed to load booking page.')
        setStep('error')
      }
    }

    if (slug) {
      loadBookingLink()
    }
  }, [slug])

  // Load time slots when a date is selected
  const loadTimeSlots = useCallback(
    async (date: Date) => {
      if (!slug) return
      setLoadingSlots(true)
      setAvailableSlots([])
      setSelectedSlot(null)

      try {
        const dateStr = format(date, 'yyyy-MM-dd')
        const res = await fetch(
          `/api/booking/availability/${slug}?date=${dateStr}&timezone=${encodeURIComponent(detectedTimezone)}`
        )

        if (res.ok) {
          const data = await res.json()
          setAvailableSlots(data.slots || [])
        }
      } catch {
        setAvailableSlots([])
      } finally {
        setLoadingSlots(false)
      }
    },
    [slug, detectedTimezone]
  )

  // Refetch time slots when timezone changes while a date is already selected.
  // loadTimeSlots is recreated when detectedTimezone changes (it's in its deps),
  // which triggers this effect. We use a ref to track whether this is the initial
  // render vs an actual timezone change.
  const prevTimezoneRef = useRef(detectedTimezone)
  useEffect(() => {
    if (prevTimezoneRef.current !== detectedTimezone) {
      prevTimezoneRef.current = detectedTimezone
      if (selectedDate && (step === 'time' || step === 'form')) {
        loadTimeSlots(selectedDate)
      }
    }
  }, [detectedTimezone, selectedDate, step, loadTimeSlots])

  function handleSelectDate(date: Date) {
    setSelectedDate(date)
    setSelectedSlot(null)
    setStep('time')
    loadTimeSlots(date)
  }

  function handleSelectSlot(slot: AvailabilitySlot) {
    setSelectedSlot(slot)
    setStep('form')
  }

  async function handleBooking(data: {
    name: string
    email: string
    notes: string
  }) {
    if (!selectedSlot || !slug) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/booking/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booker_name: data.name,
          booker_email: data.email,
          booker_notes: data.notes || null,
          start_time: selectedSlot.start,
          end_time: selectedSlot.end,
          timezone: detectedTimezone,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setErrorMessage(err.error || 'Failed to book. Please try again.')
        return
      }

      const result = await res.json()
      setBookingResult(result)
      setStep('confirmed')
    } catch {
      setErrorMessage('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const brandAccent = hostProfile?.booking_page_brand_color || undefined
  const accentStyle = brandAccent
    ? ({ '--accent': brandAccent } as React.CSSProperties)
    : undefined

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--muted)] border-t-[var(--accent)]" />
          <p className="text-sm text-[var(--muted)]">Loading...</p>
        </div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="text-center">
          <div className="mb-3 text-4xl">😕</div>
          <h1 className="mb-2 text-lg font-semibold text-[var(--fg)]">
            Page Not Found
          </h1>
          <p className="text-sm text-[var(--muted)]">{errorMessage}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-12" style={accentStyle}>
      <div className="mx-auto max-w-lg">
        {/* Host info header */}
        <div className="mb-8 text-center">
          {hostProfile?.booking_page_logo_url ? (
            <Image
              src={hostProfile.booking_page_logo_url}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="mx-auto mb-3 h-12 w-12 rounded-full object-cover"
            />
          ) : hostProfile?.avatar_url ? (
            <Image
              src={hostProfile.avatar_url}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="mx-auto mb-3 h-12 w-12 rounded-full object-cover"
            />
          ) : null}

          <h1 className="text-lg font-bold text-[var(--fg)]">
            {hostProfile?.display_name || 'Book a time'}
          </h1>

          {bookingLink && (
            <div className="mt-2">
              <p className="font-semibold text-[var(--fg)]">
                {bookingLink.name}
              </p>
              <div className="mt-1 flex items-center justify-center gap-3 text-sm text-[var(--muted)]">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {bookingLink.duration_minutes} min
                </span>
                {bookingLink.location && (
                  <span>{bookingLink.location}</span>
                )}
              </div>
            </div>
          )}

          {bookingLink?.notes && (
            <p className="mt-3 text-sm text-[var(--muted)]">
              {bookingLink.notes}
            </p>
          )}
        </div>

        {/* Main booking card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
          {step === 'confirmed' && bookingResult && bookingLink ? (
            <BookingConfirmation
              startTime={bookingResult.start_time}
              endTime={bookingResult.end_time}
              hostName={hostProfile?.display_name || 'Host'}
              meetingTitle={bookingLink.name}
              cancelToken={bookingResult.cancel_token}
              timeFormat={timeFormat}
              status={bookingResult.status ?? 'confirmed'}
            />
          ) : (
            <>
              {/* Timezone + time format controls */}
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] min-w-0">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <select
                    value={detectedTimezone}
                    onChange={(e) => {
                      setDetectedTimezone(e.target.value)
                    }}
                    className="bg-transparent text-xs text-[var(--fg)] border-none outline-none cursor-pointer truncate max-w-[200px]"
                    aria-label="Timezone"
                  >
                    {(COMMON_TIMEZONES.includes(detectedTimezone)
                      ? COMMON_TIMEZONES
                      : [detectedTimezone, ...COMMON_TIMEZONES]
                    ).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex rounded border border-[var(--border)] bg-[var(--bg)] shrink-0">
                  <button
                    onClick={() => setTimeFormat('12h')}
                    className={`px-2 py-0.5 text-xs transition-colors ${
                      timeFormat === '12h'
                        ? 'bg-[var(--accent)] text-[var(--bg)]'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    12h
                  </button>
                  <button
                    onClick={() => setTimeFormat('24h')}
                    className={`px-2 py-0.5 text-xs transition-colors ${
                      timeFormat === '24h'
                        ? 'bg-[var(--accent)] text-[var(--bg)]'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    24h
                  </button>
                </div>
              </div>

              {/* Step: Date selection */}
              {(step === 'date' || step === 'time' || step === 'form') && (
                availableDates.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-[var(--muted)]">
                      This host hasn’t opened any availability yet. Please check back later.
                    </p>
                  </div>
                ) : (
                  <BookingCalendar
                    availableDates={availableDates}
                    selectedDate={selectedDate}
                    onSelectDate={handleSelectDate}
                  />
                )
              )}

              {/* Step: Time slot selection */}
              {(step === 'time' || step === 'form') && selectedDate && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--fg)]">
                    {format(selectedDate, 'EEEE, MMMM d')}
                  </h3>
                  {loadingSlots ? (
                    <p className="py-4 text-center text-sm text-[var(--muted)]">
                      Loading available times...
                    </p>
                  ) : (
                    <TimeSlotGrid
                      slots={availableSlots}
                      selectedSlot={selectedSlot}
                      onSelectSlot={handleSelectSlot}
                      timeFormat={timeFormat}
                    />
                  )}
                </div>
              )}

              {/* Step: Booking form */}
              {step === 'form' && selectedSlot && (
                <div className="mt-6 border-t border-[var(--border)] pt-6">
                  <h3 className="mb-4 text-sm font-semibold text-[var(--fg)]">
                    Your details
                  </h3>
                  <BookingForm
                    onSubmit={handleBooking}
                    loading={submitting}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Branding footer */}
        {hostProfile?.booking_page_title !== null && (
          <div className="mt-6 text-center">
            <p className="text-xs text-[var(--muted)]">
              Powered by{' '}
              <span className="font-medium text-[var(--fg)]">Meowlendar</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
