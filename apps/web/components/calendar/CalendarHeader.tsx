'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, Circle, Settings2 } from 'lucide-react'
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameMonth,
  isSameYear,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  differenceInCalendarMonths,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { Select, type SelectOption } from '../ui/Select'
import { Popover } from '../ui/Popover'
import { Checkbox } from '../ui/Checkbox'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CalendarView = 'day' | 'week' | '2weeks' | 'month' | 'custom'

interface CalendarHeaderProps {
  currentDate: Date
  view: CalendarView | 'day' | 'week' | 'month'
  customDays?: number
  onToday: () => void
  onPrev: () => void
  onNext: () => void
  onViewChange: (view: CalendarView) => void
  /** Display setting toggles */
  showWeekends?: boolean
  widenCurrentDay?: boolean
  dimPastEvents?: boolean
  showDeclinedEvents?: boolean
  showCompletedTasks?: boolean
  mergeDuplicateEvents?: boolean
  onShowWeekendsChange?: (show: boolean) => void
  onWidenCurrentDayChange?: (widen: boolean) => void
  onDimPastEventsChange?: (dim: boolean) => void
  onShowDeclinedEventsChange?: (show: boolean) => void
  onShowCompletedTasksChange?: (show: boolean) => void
  onMergeDuplicateEventsChange?: (merge: boolean) => void
}

// ---------------------------------------------------------------------------
// View options for the Select dropdown
// ---------------------------------------------------------------------------

const VIEW_OPTIONS: SelectOption[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: '2weeks', label: '2 Weeks' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
]

// ---------------------------------------------------------------------------
// Date label formatting
// ---------------------------------------------------------------------------

export function formatDateLabel(
  date: Date,
  view: CalendarView | 'day' | 'week' | 'month',
  customDays = 3,
): string {
  switch (view) {
    case 'day':
      return format(date, 'EEEE, MMMM d, yyyy')
    case 'week':
    case '2weeks':
    case 'custom': {
      const weekStart = view === 'custom' ? date : startOfWeek(date, { weekStartsOn: 0 })
      const weekEnd = view === 'custom'
        ? addDays(date, Math.max(1, Math.min(9, customDays)) - 1)
        : view === '2weeks' ? addDays(weekStart, 13) : endOfWeek(date, { weekStartsOn: 0 })
      if (!isSameYear(weekStart, weekEnd)) {
        return `${format(weekStart, 'MMM d, yyyy')} - ${format(weekEnd, 'MMM d, yyyy')}`
      }
      if (!isSameMonth(weekStart, weekEnd)) {
        return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
      }
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
    }
    case 'month':
      return format(date, 'MMMM yyyy')
  }
}

export function formatPeriodContext(date: Date, view: CalendarView, now = new Date()): string {
  if (view === 'month') {
    const offset = differenceInCalendarMonths(date, now)
    return offset === 0 ? 'This month' : offset === 1 ? 'Next month' : offset === -1 ? 'Last month' : format(date, 'MMMM yyyy')
  }
  if (view === 'week' || view === '2weeks') {
    const offset = differenceInCalendarWeeks(date, now, { weekStartsOn: 0 })
    if (view === '2weeks') return offset === 0 ? 'This 2-week period' : `2 weeks from ${format(startOfWeek(date), 'MMM d')}`
    return offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : `Week of ${format(startOfWeek(date), 'MMM d')}`
  }
  const offset = differenceInCalendarDays(date, now)
  const day = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : format(date, 'MMM d')
  return view === 'custom' ? `From ${day}` : day
}

// ---------------------------------------------------------------------------
// CalendarHeader
// ---------------------------------------------------------------------------

export function CalendarHeader({
  currentDate,
  view,
  customDays,
  onToday,
  onPrev,
  onNext,
  onViewChange,
  showWeekends,
  widenCurrentDay,
  dimPastEvents,
  showDeclinedEvents,
  showCompletedTasks,
  mergeDuplicateEvents,
  onShowWeekendsChange,
  onWidenCurrentDayChange,
  onDimPastEventsChange,
  onShowDeclinedEventsChange,
  onShowCompletedTasksChange,
  onMergeDuplicateEventsChange,
}: CalendarHeaderProps) {
  const settingsButtonRef = React.useRef<HTMLButtonElement>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  // Map the current view to the select value, adding custom label info
  const selectValue = view

  function handleViewSelect(value: string) {
    onViewChange(value as CalendarView)
  }

  // Build options with custom day count annotation
  const options: SelectOption[] = VIEW_OPTIONS.map((opt) => {
    if (opt.value === 'custom' && customDays) {
      return { ...opt, label: `Custom (${customDays}d)` }
    }
    return opt
  })

  return (
    <div
      className={cn(
        'flex items-center justify-between px-2 py-2 md:px-4 md:py-3',
        'bg-[var(--surface)] border-b border-[var(--border)]',
        'select-none'
      )}
    >
      <div className="flex items-center gap-1.5 md:gap-3">
        <span className="text-xs md:text-sm font-medium text-[var(--fg)]">
          {formatPeriodContext(currentDate, view)}
        </span>

        <div className="flex items-center gap-0.5 md:gap-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous"
            className={cn(
              'flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md',
              'text-[var(--muted)] hover:text-[var(--fg)]',
              'hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <ChevronLeft className="w-4 h-4 md:w-[18px] md:h-[18px]" />
          </button>

          <button
            type="button"
            onClick={onToday}
            aria-label="Go to today"
            title="Go to today"
            className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
          >
            <Circle className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>

          <button
            type="button"
            onClick={onNext}
            aria-label="Next"
            className={cn(
              'flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-md',
              'text-[var(--muted)] hover:text-[var(--fg)]',
              'hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <ChevronRight className="w-4 h-4 md:w-[18px] md:h-[18px]" />
          </button>
        </div>

        <h2 className="text-sm md:text-lg font-semibold text-[var(--fg)] truncate max-w-[140px] md:max-w-none">
          {formatDateLabel(currentDate, view, customDays)}
        </h2>
      </div>

      <div className="flex items-center gap-1 md:gap-2">
        {/* View selector dropdown -- hidden on mobile, icon only */}
        <Select
          options={options}
          value={selectValue}
          onChange={handleViewSelect}
          aria-label="Calendar view"
          className="hidden md:block w-[140px]"
        />

        {/* Display settings gear button */}
        <button
          ref={settingsButtonRef}
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Display settings"
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-md',
            'transition-colors duration-150',
            settingsOpen
              ? 'text-[var(--accent)] bg-[var(--surface-hover)]'
              : 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]'
          )}
        >
          <Settings2 size={18} />
        </button>

        <Popover
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          anchorRef={settingsButtonRef}
          position="bottom"
          className="w-[220px]"
        >
          <div className="p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Display
            </p>

            <Checkbox
              label="Show weekends"
              checked={showWeekends ?? true}
              onCheckedChange={(checked) => onShowWeekendsChange?.(checked)}
            />

            <Checkbox
              label="Widen current day"
              checked={widenCurrentDay ?? true}
              onCheckedChange={(checked) => onWidenCurrentDayChange?.(checked)}
            />

            <Checkbox
              label="Dim past events"
              checked={dimPastEvents ?? true}
              onCheckedChange={(checked) => onDimPastEventsChange?.(checked)}
            />

            <Checkbox
              label="Show completed tasks"
              checked={showCompletedTasks ?? true}
              onCheckedChange={(checked) =>
                onShowCompletedTasksChange?.(checked)
              }
            />

            <Checkbox
              label="Show declined events"
              checked={showDeclinedEvents ?? false}
              onCheckedChange={(checked) =>
                onShowDeclinedEventsChange?.(checked)
              }
            />

            <Checkbox
              label="Merge duplicate events"
              checked={mergeDuplicateEvents ?? true}
              onCheckedChange={(checked) =>
                onMergeDuplicateEventsChange?.(checked)
              }
            />
          </div>
        </Popover>
      </div>
    </div>
  )
}
