'use client'

import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { MapPin, Repeat, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isAgentTask } from '@/lib/tasks/agent'
import { AgentLabel, PawIcon, PriorityCat, PRIORITY_COATS } from '@/components/brand/cats'
import type { CalendarItemData, CalendarItemType } from './calendar-types'
import { formatRange } from './time-format'

interface CalendarItemProps {
  item: CalendarItemData
  style: React.CSSProperties
  /** Pixels per hour — used so resize honors the current zoom (not a fixed 60). */
  hourHeight?: number
  /** Snap resolution for resize, in minutes. */
  resizeResolution?: number
  /** When on, past and completed items render dimmed (#21, #86). */
  dimPastEvents?: boolean
  /** Shares its time with another item, so it sits in a narrow lane. */
  narrow?: boolean
  /** Today's column passes the current time so the item under it can show "Now". */
  nowMs?: number
  onItemClick?: (item: CalendarItemData, anchorRect?: DOMRect) => void
  onItemDoubleClick?: (item: CalendarItemData) => void
  onResizeStart?: (item: CalendarItemData) => void
  onItemResize?: (itemId: string, itemType: CalendarItemType, newEnd: Date) => void
  onRoutineCheckboxClick?: (item: CalendarItemData) => void
  onTaskCheckboxClick?: (item: CalendarItemData) => void
}

const FREQ_LABELS: Record<string, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }

function repeatLabel(rule: string | null | undefined): string | null {
  if (!rule) return null
  const freq = /FREQ=([A-Z]+)/.exec(rule)?.[1]
  return (freq && FREQ_LABELS[freq]) || 'Repeats'
}

// Event text sizes as the design draws them: one line under 30px, no detail row under 62px.
// Two title lines plus the time need about 56px; below that the title keeps to one line, or a
// 45-minute item (43px at 60px an hour) pushes its time row out of the box.
const TINY_PX = 30
const TWO_LINE_PX = 56
const SHORT_PX = 62

/**
 * One item on the week grid. Events are a light tint of their calendar colour with a bar on the
 * left; tasks are white cards with a check box and a priority cat on the frame; routines are
 * striped with a dot.
 */
export const CalendarItem = React.memo(function CalendarItem({
  item,
  style: positionStyle,
  hourHeight = 60,
  resizeResolution = 15,
  dimPastEvents = false,
  narrow = false,
  nowMs,
  onItemClick,
  onItemDoubleClick,
  onResizeStart,
  onItemResize,
  onRoutineCheckboxClick,
  onTaskCheckboxClick,
}: CalendarItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'calendar-item', item },
  })

  const isTaskCompleted = item.type === 'task' && item.task?.status === 'done'
  const isRoutineCompleted = item.type === 'routine' && item.routineInstanceStatus === 'completed'
  const isCompleted = isTaskCompleted || isRoutineCompleted
  const isPast = item.endTime.getTime() < Date.now()
  const shouldDim = dimPastEvents && (isPast || isCompleted)
  const isLive = nowMs != null && item.startTime.getTime() <= nowMs && item.endTime.getTime() > nowMs
  const isAgent = item.type === 'task' && isAgentTask(item.task)
  const heightNum = parseFloat(String(positionStyle.height) || '0')
  const tiny = heightNum < TINY_PX
  const oneLine = !tiny && heightNum < TWO_LINE_PX
  const short = heightNum < SHORT_PX

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onItemClick?.(item, rect)
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation()
    onItemDoubleClick?.(item)
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    onResizeStart?.(item)

    const startY = e.clientY
    const originalEndTime = item.endTime
    const hourHeightPx = hourHeight // pixels per hour, respects zoom level

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const deltaMinutes =
        Math.round(deltaY / (hourHeightPx / 60) / resizeResolution) * resizeResolution
      const newEnd = new Date(originalEndTime.getTime() + deltaMinutes * 60000)
      if (newEnd > item.startTime) {
        onItemResize?.(item.id, item.type, newEnd)
      }
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  function handleTaskCheckbox(e: React.MouseEvent) {
    e.stopPropagation()
    onTaskCheckboxClick?.(item)
  }

  function handleRoutineCheckbox(e: React.MouseEvent) {
    e.stopPropagation()
    onRoutineCheckboxClick?.(item)
  }

  const repeat = item.type === 'event' ? repeatLabel(item.event?.recurrence_rule) : item.type === 'routine' ? repeatLabel(item.routine?.recurrence_rule) : null
  const location = item.location ?? null
  const meta: React.ReactNode[] = []
  if (isLive) meta.push(<span key="now" className="meow-livetag">Now</span>)
  if (item.event?.conferencing_url) meta.push(<span key="video"><Video size={12} />Video call</span>)
  if (location && heightNum > 60) meta.push(<span key="loc"><MapPin size={12} />{location}</span>)
  if (repeat && heightNum > 40) meta.push(<span key="rep"><Repeat size={12} />{repeat}</span>)

  const coat = item.type === 'task' && item.task ? PRIORITY_COATS[item.task.importance] : null

  return (
    <>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        data-calendar-item
        data-item-id={item.id}
        data-item-type={item.type}
        style={{
          ...positionStyle,
          '--c': item.color,
          opacity: isDragging ? 0.4 : undefined,
          zIndex: isDragging ? 100 : undefined,
        } as React.CSSProperties}
        className={cn(
          'meow-ev group',
          `is-${item.type}`,
          tiny && 'is-tiny',
          oneLine && 'is-oneline',
          short && 'is-short',
          narrow && 'is-nar',
          shouldDim && 'is-past',
          isLive && 'is-live',
          isAgent && 'is-agent'
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="meow-ev-t" data-fit-part>
          {item.type === 'task' && (
            <button
              type="button"
              onClick={handleTaskCheckbox}
              className={cn('meow-ev-box', isTaskCompleted && 'is-done')}
              aria-label={isTaskCompleted ? 'Reopen task' : 'Complete task'}
            >
              {isTaskCompleted && <PawIcon />}
            </button>
          )}
          {item.type === 'routine' && (
            <button
              type="button"
              onClick={handleRoutineCheckbox}
              className={cn('meow-ev-dot', isRoutineCompleted && 'is-done')}
              aria-label={isRoutineCompleted ? 'Uncheck routine' : 'Complete routine'}
            />
          )}
          <span data-fit-title className={cn(isCompleted && 'line-through')}>
            {item.title}
          </span>
          {item.subtaskProgress && (
            <span className="meow-ev-sub">
              {item.subtaskProgress.completed}/{item.subtaskProgress.total}
            </span>
          )}
        </div>
        {!tiny && (
          <div className="meow-ev-tm" data-fit-part>
            {formatRange(item.startTime, item.endTime)}
          </div>
        )}
        {!short && meta.length > 0 && (
          <div className="meow-ev-mi" data-fit-part>
            {meta}
          </div>
        )}
        {isAgent && !tiny && (
          <div className="meow-ev-ag" data-fit-part>
            <AgentLabel />
          </div>
        )}
        <div className="meow-ev-resize" onMouseDown={handleResizeMouseDown} />
      </div>

      {coat && item.task && (
        <div
          className="meow-peek"
          aria-hidden="true"
          style={{
            top: `calc(${typeof positionStyle.top === 'number' ? `${positionStyle.top}px` : positionStyle.top ?? '0px'} - 13.8px)`,
            left: `calc(${positionStyle.left ?? '0px'} + ${positionStyle.width ?? '100%'} - 35px)`,
          }}
        >
          <PriorityCat importance={item.task.importance} />
        </div>
      )}
    </>
  )
})
