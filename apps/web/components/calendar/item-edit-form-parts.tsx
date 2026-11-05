'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

export const IMPORTANCE_OPTIONS = [
  { value: 'lowest', label: 'Lowest', color: '#6d6152' },
  { value: 'low', label: 'Low', color: '#8b7d69' },
  { value: 'normal', label: 'Normal', color: '#d6b48a' },
  { value: 'high', label: 'High', color: '#e07a12' },
  { value: 'highest', label: 'Highest', color: '#c8432f' },
] as const

/**
 * Format a datetime string, falling back when it is absent or not a valid
 * date (e.g. a routine's "HH:mm" value reaching an event-tab field init).
 */
export function safeFormatDate(
  value: string | undefined,
  fmt: string,
  fallback: string
): string {
  if (!value) return fallback
  const d = new Date(value)
  if (isNaN(d.getTime())) return fallback
  return format(d, fmt)
}

/**
 * The instant for a date and time typed into the form, read in the user's own zone. An
 * offset-less "2026-11-05T14:00:00" is read by Postgres as UTC, which moved a 2 PM event in
 * New York to 9 AM on Save.
 */
export function localInstant(date: string, time: string): string {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number)
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

/**
 * All-day items store their calendar date at UTC midnight and are read back by that date part
 * (see gridDate in grid-items), so the date never shifts with the viewer's zone.
 */
export function allDayInstant(date: string): string {
  return `${date}T00:00:00.000Z`
}

/** The calendar date an all-day timestamp stands for: its date part, never shifted to local time. */
export function allDayDate(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : fallback
}

/** A YYYY-MM-DD date moved by whole days. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * All-day ends are exclusive, as Google stores them: one day D runs to D+1 00:00. The form shows
 * the last day itself, never before the first (a row saved with no length reads as one day).
 */
export function allDayLastDate(start: string, exclusiveEnd: string): string {
  const last = shiftDate(exclusiveEnd, -1)
  return last < start ? start : last
}

export function fieldClass(extra?: string) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-md',
    'bg-[var(--bg)] border border-[var(--border)]',
    'text-[var(--fg)] placeholder:text-[var(--muted)]',
    'focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1 focus:ring-offset-[var(--surface)]',
    extra
  )
}

export function SectionDivider() {
  return <div className="border-t border-[var(--border)] my-4" />
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
      {children}
    </label>
  )
}

export function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; icon?: React.ElementType }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
      {options.map((opt) => {
        const active = value === opt.value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium',
              'transition-colors duration-150',
              'border-l border-[var(--border)] first:border-l-0',
              active
                ? 'bg-[var(--accent)] text-[var(--bg)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]'
            )}
          >
            {Icon && <Icon size={12} />}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
