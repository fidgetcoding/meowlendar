'use client'

import { format, parseISO } from 'date-fns'
import type { AvailabilitySlot } from '@poolendar/types'

interface TimeSlotGridProps {
  slots: AvailabilitySlot[]
  selectedSlot: AvailabilitySlot | null
  onSelectSlot: (slot: AvailabilitySlot) => void
  timeFormat: '12h' | '24h'
}

export function TimeSlotGrid({
  slots,
  selectedSlot,
  onSelectSlot,
  timeFormat,
}: TimeSlotGridProps) {
  if (slots.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--muted)]">
          No available times for this date
        </p>
      </div>
    )
  }

  function formatTime(iso: string): string {
    const date = parseISO(iso)
    if (timeFormat === '24h') {
      return format(date, 'HH:mm')
    }
    return format(date, 'h:mm a')
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {slots.map((slot) => {
        const isSelected =
          selectedSlot?.start === slot.start &&
          selectedSlot?.end === slot.end

        return (
          <button
            key={slot.start}
            onClick={() => onSelectSlot(slot)}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              isSelected
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
            }`}
            aria-pressed={isSelected}
          >
            {formatTime(slot.start)}
          </button>
        )
      })}
    </div>
  )
}
