'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { format, isSameDay, isSameMonth, isToday } from 'date-fns'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarItemData } from './calendar-types'
import { getReadableTextColor } from './event-color'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_MAX_VISIBLE_ITEMS = 4

interface MonthGridProps {
  currentDate: Date
  visibleDays: Date[]
  items: CalendarItemData[]
  /** Max items shown per day cell before "+N more" (#9a, from settings). */
  limitPerDay?: number
  onItemClick?: (item: CalendarItemData, anchorRect?: DOMRect) => void
  onItemDoubleClick?: (item: CalendarItemData) => void
}

// ---------------------------------------------------------------------------
// Day overflow popover
// ---------------------------------------------------------------------------

interface DayOverflowPopoverProps {
  date: Date
  items: CalendarItemData[]
  anchorRect: DOMRect
  onItemClick?: (item: CalendarItemData) => void
  onItemDoubleClick?: (item: CalendarItemData) => void
  onClose: () => void
}

function DayOverflowPopover({
  date,
  items,
  anchorRect,
  onItemClick,
  onItemDoubleClick,
  onClose,
}: DayOverflowPopoverProps) {
  const popoverRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Position below the anchor, with viewport clamping
  const POPOVER_WIDTH = 220
  const GAP = 4
  const VIEWPORT_PADDING = 12

  let top = anchorRect.bottom + GAP
  let left = anchorRect.left

  if (left + POPOVER_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
    left = window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING
  }
  if (left < VIEWPORT_PADDING) {
    left = VIEWPORT_PADDING
  }

  const maxHeight = window.innerHeight - top - VIEWPORT_PADDING
  if (maxHeight < 120) {
    top = anchorRect.top - 200 - GAP
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`All items for ${format(date, 'MMMM d')}`}
      className={cn(
        'fixed z-50',
        'rounded-lg border border-[var(--border)]',
        'bg-[var(--surface)] shadow-xl shadow-black/40',
        'animate-in fade-in-0 zoom-in-95 duration-150'
      )}
      style={{
        top,
        left,
        width: POPOVER_WIDTH,
        maxHeight: Math.min(300, Math.max(120, maxHeight)),
        overflow: 'hidden',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--fg)]">
          {format(date, 'EEEE, MMM d')}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
        >
          <X size={12} />
        </button>
      </div>
      <div className="overflow-y-auto p-1" style={{ maxHeight: 250 }}>
        {items.map((item) => (
          <MonthPill
            key={item.id}
            item={item}
            onItemClick={onItemClick}
            onItemDoubleClick={onItemDoubleClick}
          />
        ))}
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// MonthGrid
// ---------------------------------------------------------------------------

export function MonthGrid({
  currentDate,
  visibleDays,
  items,
  limitPerDay = DEFAULT_MAX_VISIBLE_ITEMS,
  onItemClick,
  onItemDoubleClick,
}: MonthGridProps) {
  const [expandedDay, setExpandedDay] = React.useState<{
    date: Date
    items: CalendarItemData[]
    anchorRect: DOMRect
  } | null>(null)

  function handleShowMore(
    e: React.MouseEvent<HTMLButtonElement>,
    day: Date,
    dayItems: CalendarItemData[]
  ) {
    e.stopPropagation()
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setExpandedDay({ date: day, items: dayItems, anchorRect: rect })
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface)]">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className={cn(
              'py-2 text-center text-xs font-medium uppercase',
              'text-[var(--muted)]',
              'border-l border-[var(--border)] first:border-l-0'
            )}
          >
            {name}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 auto-rows-fr">
        {visibleDays.map((day) => {
          const dayItems = items.filter((item) => isSameDay(item.startTime, day))
          const today = isToday(day)
          const inMonth = isSameMonth(day, currentDate)
          const visible = dayItems.slice(0, limitPerDay)
          const overflowCount = dayItems.length - limitPerDay

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'min-h-[100px] p-1',
                'border-b border-l border-[var(--border)]',
                !inMonth && 'opacity-40'
              )}
            >
              <div className="flex justify-end">
                <span
                  className={cn(
                    'flex items-center justify-center',
                    'w-6 h-6 rounded-full text-xs font-medium',
                    today
                      ? 'bg-[var(--accent)] text-[var(--bg)]'
                      : 'text-[var(--fg)]'
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>

              <div className="mt-0.5 flex flex-col gap-0.5">
                {visible.map((item) => (
                  <MonthPill
                    key={item.id}
                    item={item}
                    onItemClick={onItemClick}
                    onItemDoubleClick={onItemDoubleClick}
                  />
                ))}

                {overflowCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => handleShowMore(e, day, dayItems)}
                    className={cn(
                      'text-left text-[10px] font-medium px-1.5 py-0.5 rounded',
                      'text-[var(--muted)] hover:text-[var(--fg)]',
                      'hover:bg-[var(--surface-hover)]',
                      'transition-colors duration-150'
                    )}
                  >
                    +{overflowCount} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {expandedDay && (
        <DayOverflowPopover
          date={expandedDay.date}
          items={expandedDay.items}
          anchorRect={expandedDay.anchorRect}
          onItemClick={onItemClick}
          onItemDoubleClick={onItemDoubleClick}
          onClose={() => setExpandedDay(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Month pill sub-component
// ---------------------------------------------------------------------------

interface MonthPillProps {
  item: CalendarItemData
  onItemClick?: (item: CalendarItemData, anchorRect?: DOMRect) => void
  onItemDoubleClick?: (item: CalendarItemData) => void
}

function MonthPill({ item, onItemClick, onItemDoubleClick }: MonthPillProps) {
  const isEvent = item.type === 'event'
  const isCompleted = item.type === 'task' && item.task?.status === 'done'

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onItemClick?.(item, rect)
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onItemDoubleClick?.(item)
  }

  if (isEvent) {
    return (
      <button
        type="button"
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded text-left',
          'transition-[filter] duration-150 hover:brightness-110',
          'w-full overflow-hidden'
        )}
        style={{ backgroundColor: item.color }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <span className="text-[10px] font-medium truncate" style={{ color: getReadableTextColor(item.color) }}>
          {item.title}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded text-left',
        'transition-colors duration-150',
        'hover:bg-[var(--surface-hover)]',
        'w-full overflow-hidden'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <span
        className="shrink-0 w-2 h-2 rounded-full"
        style={{ backgroundColor: item.color }}
      />
      <span
        className={cn(
          'text-[10px] font-medium truncate',
          isCompleted
            ? 'text-[var(--muted)] line-through'
            : 'text-[var(--fg)]'
        )}
      >
        {item.title}
      </span>
    </button>
  )
}
