'use client'

import { useState } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isBefore,
  startOfDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface BookingCalendarProps {
  availableDates: Date[]
  selectedDate: Date | null
  onSelectDate: (date: Date) => void
}

export function BookingCalendar({
  availableDates,
  selectedDate,
  onSelectDate,
}: BookingCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const today = startOfDay(new Date())

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })

  // Build calendar grid
  const days: Date[] = []
  let day = calendarStart
  while (day <= calendarEnd) {
    days.push(day)
    day = addDays(day, 1)
  }

  function isAvailable(date: Date): boolean {
    return availableDates.some((d) => isSameDay(d, date))
  }

  function isPast(date: Date): boolean {
    return isBefore(date, today)
  }

  return (
    <div>
      {/* Month header */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="text-sm font-semibold text-[var(--fg)]">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <button
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-1 text-center text-xs font-medium text-[var(--muted)]"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const inMonth = isSameMonth(d, currentMonth)
          const available = isAvailable(d) && !isPast(d)
          const selected = selectedDate && isSameDay(d, selectedDate)
          const past = isPast(d)

          return (
            <button
              key={d.toISOString()}
              onClick={() => available && onSelectDate(d)}
              disabled={!available}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm transition-colors ${
                !inMonth
                  ? 'text-[var(--border)]'
                  : selected
                    ? 'bg-[var(--accent)] font-semibold text-[var(--bg)]'
                    : available
                      ? 'font-medium text-[var(--fg)] hover:bg-[var(--accent)]/20 hover:text-[var(--accent)]'
                      : past
                        ? 'text-[var(--border)] cursor-not-allowed'
                        : 'text-[var(--muted)] cursor-not-allowed'
              }`}
              aria-label={format(d, 'EEEE, MMMM d, yyyy')}
              aria-pressed={Boolean(selected)}
            >
              {format(d, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
