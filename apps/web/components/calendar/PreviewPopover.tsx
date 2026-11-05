'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import {
  Clock,
  MapPin,
  Pencil,
  Trash2,
  Check,
  SkipForward,
  Repeat2,
  Video,
  CalendarDays,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarEvent, Task, Routine } from '@poolendar/types'
import { RecurrenceEditDialog, type RecurrenceEditScope } from './RecurrenceEditDialog'
import { AlsoOnLine, RsvpRow } from './EventCopies'
import type { RsvpCopy } from './event-copies'
import type { RsvpAnswer } from '@/lib/hooks/use-events'

type PreviewItem = {
  type: 'event' | 'task' | 'routine'
  event?: CalendarEvent
  task?: Task
  routine?: Routine
  calendarName?: string
  calendarColor?: string
}

interface PreviewPopoverProps {
  item: PreviewItem
  anchorRect: DOMRect | null
  onClose: () => void
  onEdit: (scope?: RecurrenceEditScope) => void
  onDelete: (scope?: RecurrenceEditScope) => void
  onComplete?: () => void
  onSkip?: () => void
  /** The other calendars a merged meeting is on. */
  alsoOn?: string[]
  /** The copies you can answer from, the shown one first. */
  rsvpCopies?: RsvpCopy[]
  onRsvp?: (eventId: string, answer: RsvpAnswer) => Promise<unknown>
}

const POPOVER_WIDTH = 300
const POPOVER_HEIGHT_ESTIMATE = 280
const VIEWPORT_PADDING = 12
const GAP = 8

function computePosition(anchor: DOMRect): { top: number; left: number } {
  let top = anchor.bottom + GAP
  let left = anchor.left

  if (top + POPOVER_HEIGHT_ESTIMATE > window.innerHeight - VIEWPORT_PADDING) {
    top = anchor.top - POPOVER_HEIGHT_ESTIMATE - GAP
  }
  if (top < VIEWPORT_PADDING) {
    top = VIEWPORT_PADDING
  }

  if (left + POPOVER_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
    left = window.innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING
  }
  if (left < VIEWPORT_PADDING) {
    left = VIEWPORT_PADDING
  }

  return { top, left }
}

const IMPORTANCE_COLORS: Record<string, string> = {
  highest: '#c8432f',
  high: '#e07a12',
  normal: '#d6b48a',
  low: '#8b7d69',
  lowest: '#6d6152',
}

function ImportanceBadge({ importance }: { importance: string }) {
  const color = IMPORTANCE_COLORS[importance] ?? IMPORTANCE_COLORS.normal
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium capitalize"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {importance}
    </span>
  )
}

function SubtaskProgress({
  completed,
  total,
}: {
  completed: number
  total: number
}) {
  const percent = total > 0 ? (completed / total) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-[var(--muted)] shrink-0">
        {completed}/{total} complete
      </span>
    </div>
  )
}

export function PreviewPopover({
  item,
  anchorRect,
  onClose,
  onEdit,
  onDelete,
  onComplete,
  onSkip,
  alsoOn = [],
  rsvpCopies = [],
  onRsvp,
}: PreviewPopoverProps) {
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = React.useState(false)
  const [recurrenceDialog, setRecurrenceDialog] = React.useState<{
    isOpen: boolean
    mode: 'edit' | 'delete'
  }>({ isOpen: false, mode: 'edit' })

  // Determine if this item is recurring
  const isRecurring = React.useMemo(() => {
    if (item.type === 'event' && item.event?.recurrence_rule) return true
    if (item.type === 'routine' && item.routine?.recurrence_rule) return true
    return false
  }, [item])

  const itemTitle = React.useMemo(() => {
    if (item.type === 'event' && item.event) return item.event.title
    if (item.type === 'task' && item.task) return item.task.title
    if (item.type === 'routine' && item.routine) return item.routine.title
    return ''
  }, [item])

  function handleEditClick() {
    if (isRecurring) {
      setRecurrenceDialog({ isOpen: true, mode: 'edit' })
    } else {
      onEdit()
    }
  }

  function handleDeleteClick() {
    if (isRecurring) {
      setRecurrenceDialog({ isOpen: true, mode: 'delete' })
    } else {
      onDelete()
    }
  }

  function handleRecurrenceScopeSelect(scope: RecurrenceEditScope) {
    setRecurrenceDialog({ isOpen: false, mode: recurrenceDialog.mode })
    if (recurrenceDialog.mode === 'edit') {
      onEdit(scope)
    } else {
      onDelete(scope)
    }
  }

  React.useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])

  React.useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (recurrenceDialog.isOpen) {
          setRecurrenceDialog({ isOpen: false, mode: recurrenceDialog.mode })
          return
        }
        e.stopPropagation()
        onClose()
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (recurrenceDialog.isOpen) return
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
  }, [onClose, recurrenceDialog.isOpen, recurrenceDialog.mode])

  if (!isMounted || !anchorRect) return null

  const position = computePosition(anchorRect)
  const color = item.calendarColor ?? '#e8930c'

  let title = ''
  let timeRange = ''
  let location: string | null = null
  let conferenceUrl: string | null = null

  if (item.type === 'event' && item.event) {
    const e = item.event
    title = e.title
    timeRange = `${format(new Date(e.start_time), 'h:mm a')} - ${format(new Date(e.end_time), 'h:mm a')}`
    location = e.location
    conferenceUrl = e.conferencing_url
  } else if (item.type === 'task' && item.task) {
    const t = item.task
    title = t.title
    if (t.scheduled_start && t.scheduled_end) {
      timeRange = `${format(new Date(t.scheduled_start), 'h:mm a')} - ${format(new Date(t.scheduled_end), 'h:mm a')}`
    }
    location = t.location
  } else if (item.type === 'routine' && item.routine) {
    const r = item.routine
    title = r.title
    const parseTimeString = (timeStr: string): [number, number] => {
      const timePart = timeStr.includes('T') ? timeStr.split('T')[1]! : timeStr
      const [h, m] = timePart.split(':').map(Number)
      return [h || 0, m || 0]
    }
    const [startH, startM] = parseTimeString(r.start_time)
    const [endH, endM] = parseTimeString(r.end_time)
    const startDate = new Date()
    startDate.setHours(startH, startM, 0, 0)
    const endDate = new Date()
    endDate.setHours(endH, endM, 0, 0)
    timeRange = `${format(startDate, 'h:mm a')} - ${format(endDate, 'h:mm a')}`
    location = r.location
  }

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Preview: ${title}`}
      className={cn(
        'fixed z-50',
        'rounded-lg border border-[var(--border)]',
        'bg-[var(--surface)] shadow-xl shadow-black/40',
        'animate-in fade-in-0 zoom-in-95 duration-150'
      )}
      style={{
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
      }}
    >
      {/* Color bar */}
      <div
        className="h-1 rounded-t-lg"
        style={{ backgroundColor: color }}
      />

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'absolute top-2 right-2',
          'flex items-center justify-center w-6 h-6 rounded',
          'text-[var(--muted)] hover:text-[var(--fg)]',
          'hover:bg-[var(--surface-hover)]',
          'transition-colors duration-150'
        )}
      >
        <X size={14} />
      </button>

      <div className="px-4 pt-3 pb-2">
        {/* Title */}
        <h3 className="text-base font-semibold text-[var(--fg)] pr-6">
          {title}
        </h3>

        {/* Time */}
        {timeRange && (
          <div className="flex items-center gap-2 mt-2 text-sm text-[var(--muted)]">
            <Clock size={14} className="shrink-0" />
            <span>{timeRange}</span>
          </div>
        )}

        {/* Location */}
        {location && (
          <div className="flex items-center gap-2 mt-1.5 text-sm text-[var(--muted)]">
            <MapPin size={14} className="shrink-0" />
            <span className="truncate">{location}</span>
          </div>
        )}

        {/* Calendar */}
        {item.calendarName && (
          <div className="flex items-center gap-2 mt-1.5 text-sm text-[var(--muted)]">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span>{item.calendarName}</span>
          </div>
        )}

        {/* Event-specific */}
        {item.type === 'event' && item.event && (
          <>
            <AlsoOnLine labels={alsoOn} className="mt-1 pl-[18px]" />
            {item.event.attendees.length > 0 && (
              <div className="mt-2 text-xs text-[var(--muted)]">
                {item.event.attendees.length} attendee{item.event.attendees.length !== 1 ? 's' : ''}
              </div>
            )}
            {onRsvp && rsvpCopies.length > 0 && <RsvpRow copies={rsvpCopies} onRespond={onRsvp} />}
          </>
        )}

        {/* Task-specific */}
        {item.type === 'task' && item.task && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <ImportanceBadge importance={item.task.importance} />
              {item.task.due_date && (
                <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
                  <CalendarDays size={12} />
                  <span>Due {format(new Date(item.task.due_date), 'MMM d')}</span>
                </div>
              )}
            </div>
            {item.task.subtasks && item.task.subtasks.length > 0 && (
              <SubtaskProgress
                completed={item.task.subtasks.filter((s) => s.completed).length}
                total={item.task.subtasks.length}
              />
            )}
            {item.task.tags && item.task.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.task.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      backgroundColor: `${tag.color}33`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Routine-specific */}
        {item.type === 'routine' && item.routine && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-[var(--muted)]">
            <Repeat2 size={12} />
            <span>{item.routine.recurrence_rule ?? 'Recurring'}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-[var(--border)]">
        <button
          type="button"
          onClick={handleEditClick}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
            'text-[var(--fg)] hover:bg-[var(--surface-hover)]',
            'transition-colors duration-150'
          )}
        >
          <Pencil size={14} />
          <span>Edit</span>
        </button>

        {item.type === 'event' && conferenceUrl && (
          <a
            href={conferenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
              'text-[var(--fg)] hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <Video size={14} />
            <span>Join</span>
          </a>
        )}

        {item.type === 'task' && onComplete && (
          <button
            type="button"
            onClick={onComplete}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
              'text-[var(--success)] hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <Check size={14} />
            <span>Complete</span>
          </button>
        )}

        {item.type === 'routine' && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm',
              'text-[var(--muted)] hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <SkipForward size={14} />
            <span>Skip</span>
          </button>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleDeleteClick}
          aria-label="Delete"
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-md',
            'text-[var(--muted)] hover:text-[var(--destructive)]',
            'hover:bg-[var(--surface-hover)]',
            'transition-colors duration-150'
          )}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Recurrence scope dialog for recurring items */}
      <RecurrenceEditDialog
        isOpen={recurrenceDialog.isOpen}
        onClose={() => setRecurrenceDialog({ isOpen: false, mode: recurrenceDialog.mode })}
        onSelect={handleRecurrenceScopeSelect}
        itemTitle={itemTitle}
        mode={recurrenceDialog.mode}
      />
    </div>,
    document.body
  )
}
