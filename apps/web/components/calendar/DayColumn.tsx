'use client'

import * as React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarItemData, CalendarItemType } from './calendar-types'
import { CalendarItem } from './CalendarItem'

interface DayColumnProps {
  date: Date
  items: CalendarItemData[]
  hourHeight: number
  isToday: boolean
  startHour?: number
  endHour?: number
  draggingResolution?: number
  dimPastEvents?: boolean
  onTimeSlotClick?: (date: Date, startTime: Date, endTime?: Date) => void
  onItemClick?: (item: CalendarItemData, anchorRect?: DOMRect) => void
  onItemDoubleClick?: (item: CalendarItemData) => void
  onItemResize?: (itemId: string, itemType: CalendarItemType, newEnd: Date) => void
  onRoutineCheckboxClick?: (item: CalendarItemData) => void
  onTaskCheckboxClick?: (item: CalendarItemData) => void
}

interface DragCreateState {
  startY: number
  currentY: number
  startTime: Date
}

const DRAG_THRESHOLD = 10
const SINGLE_CLICK_DELAY = 200

interface LayoutColumn {
  item: CalendarItemData
  columnIndex: number
  totalColumns: number
}

function computeOverlapLayout(items: CalendarItemData[]): LayoutColumn[] {
  if (items.length === 0) return []

  const sorted = [...items].sort((a, b) => {
    const diff = a.startTime.getTime() - b.startTime.getTime()
    if (diff !== 0) return diff
    return b.endTime.getTime() - a.endTime.getTime()
  })

  const result: LayoutColumn[] = []
  const groups: CalendarItemData[][] = []
  let currentGroup: CalendarItemData[] = []
  let currentGroupEnd = 0

  for (const item of sorted) {
    const itemStart = item.startTime.getTime()

    if (currentGroup.length === 0 || itemStart < currentGroupEnd) {
      currentGroup.push(item)
      currentGroupEnd = Math.max(currentGroupEnd, item.endTime.getTime())
    } else {
      groups.push(currentGroup)
      currentGroup = [item]
      currentGroupEnd = item.endTime.getTime()
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  for (const group of groups) {
    const columns: CalendarItemData[][] = []

    for (const item of group) {
      let placed = false
      for (let col = 0; col < columns.length; col++) {
        const colItems = columns[col]!
        const lastInCol = colItems[colItems.length - 1]!
        if (item.startTime.getTime() >= lastInCol.endTime.getTime()) {
          colItems.push(item)
          placed = true
          break
        }
      }
      if (!placed) {
        columns.push([item])
      }
    }

    const totalColumns = columns.length
    for (let col = 0; col < columns.length; col++) {
      for (const item of columns[col]!) {
        result.push({ item, columnIndex: col, totalColumns })
      }
    }
  }

  return result
}

function getTimePosition(time: Date, hourHeight: number, startHour: number): number {
  const hours = time.getHours()
  const minutes = time.getMinutes()
  return (hours - startHour + minutes / 60) * hourHeight
}

function snapToResolution(minutes: number, resolution: number): number {
  return Math.round(minutes / resolution) * resolution
}

const CURRENT_TIME_UPDATE_MS = 60_000
const MIN_ITEM_HEIGHT = 20

export const DayColumn = React.memo(function DayColumn({
  date,
  items,
  hourHeight,
  isToday,
  startHour = 0,
  endHour = 24,
  draggingResolution = 15,
  dimPastEvents = false,
  onTimeSlotClick,
  onItemClick,
  onItemDoubleClick,
  onItemResize,
  onRoutineCheckboxClick,
  onTaskCheckboxClick,
}: DayColumnProps) {
  const [currentMinutes, setCurrentMinutes] = React.useState(() => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  })

  const [dragCreate, setDragCreate] = React.useState<DragCreateState | null>(null)
  const isDraggingRef = React.useRef(false)
  const suppressClickRef = React.useRef(false)
  const singleClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const columnRef = React.useRef<HTMLDivElement | null>(null)

  const { setNodeRef, isOver } = useDroppable({
    id: `day-${date.toISOString()}`,
    data: { type: 'day-column', date },
  })

  // Combine droppable ref with our local ref
  const combinedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      columnRef.current = node
      setNodeRef(node)
    },
    [setNodeRef]
  )

  React.useEffect(() => {
    if (!isToday) return

    function tick() {
      const now = new Date()
      setCurrentMinutes(now.getHours() * 60 + now.getMinutes())
    }

    const id = setInterval(tick, CURRENT_TIME_UPDATE_MS)
    return () => clearInterval(id)
  }, [isToday])

  // Clean up single-click timer on unmount
  React.useEffect(() => {
    return () => {
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current)
      }
    }
  }, [])

  const totalHeight = (endHour - startHour) * hourHeight
  const layout = computeOverlapLayout(items)
  const currentTimeTop = (currentMinutes / 60 - startHour) * hourHeight

  function yOffsetToTime(yOffset: number): Date {
    const rawMinutes = (yOffset / hourHeight) * 60 + startHour * 60
    const snappedMinutes = snapToResolution(rawMinutes, draggingResolution)
    const clampedMinutes = Math.max(
      startHour * 60,
      Math.min(endHour * 60, snappedMinutes)
    )
    const hour = Math.floor(clampedMinutes / 60)
    const minute = clampedMinutes % 60
    const time = new Date(date)
    time.setHours(hour, minute, 0, 0)
    return time
  }

  // ---- Drag-to-create handlers ----

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Only start drag on the column background (left button, not on an item)
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-calendar-item]')) return

    const rect = e.currentTarget.getBoundingClientRect()
    const yOffset = e.clientY - rect.top
    const startTime = yOffsetToTime(yOffset)

    isDraggingRef.current = false
    setDragCreate({
      startY: yOffset,
      currentY: yOffset,
      startTime,
    })
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragCreate) return

    const rect = e.currentTarget.getBoundingClientRect()
    const yOffset = Math.max(0, Math.min(totalHeight, e.clientY - rect.top))
    const distance = Math.abs(yOffset - dragCreate.startY)

    if (distance > DRAG_THRESHOLD) {
      isDraggingRef.current = true
    }

    setDragCreate((prev) =>
      prev ? { ...prev, currentY: yOffset } : null
    )
  }

  function handleMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragCreate) return

    const wasDragging = isDraggingRef.current

    if (wasDragging && onTimeSlotClick) {
      // Suppress the click event that fires after mouseup
      suppressClickRef.current = true

      // Drag-to-create: calculate start and end from the drag range
      const rect = e.currentTarget.getBoundingClientRect()
      const finalY = Math.max(0, Math.min(totalHeight, e.clientY - rect.top))
      const minY = Math.min(dragCreate.startY, finalY)
      const maxY = Math.max(dragCreate.startY, finalY)

      const rangeStart = yOffsetToTime(minY)
      const rangeEnd = yOffsetToTime(maxY)

      // Ensure at least 15 min
      if (rangeEnd.getTime() <= rangeStart.getTime()) {
        rangeEnd.setTime(rangeStart.getTime() + 15 * 60 * 1000)
      }

      onTimeSlotClick(date, rangeStart, rangeEnd)
    }

    isDraggingRef.current = false
    setDragCreate(null)
  }

  function handleMouseLeave() {
    // If dragging leaves the column, cancel the drag preview
    if (dragCreate && isDraggingRef.current) {
      isDraggingRef.current = false
      setDragCreate(null)
    }
  }

  // ---- Click and double-click handlers ----

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>) {
    // If we just finished a drag-to-create, don't fire click
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!onTimeSlotClick) return
    if ((e.target as HTMLElement).closest('[data-calendar-item]')) return

    const rect = e.currentTarget.getBoundingClientRect()
    const yOffset = e.clientY - rect.top
    const clickTime = yOffsetToTime(yOffset)

    // Delay single-click so double-click can cancel it
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current)
    }

    singleClickTimerRef.current = setTimeout(() => {
      singleClickTimerRef.current = null
      // Default 30-min event on single click
      onTimeSlotClick(date, clickTime)
    }, SINGLE_CLICK_DELAY)
  }

  function handleColumnDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onTimeSlotClick) return
    if ((e.target as HTMLElement).closest('[data-calendar-item]')) return

    // Cancel the pending single-click
    if (singleClickTimerRef.current) {
      clearTimeout(singleClickTimerRef.current)
      singleClickTimerRef.current = null
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const yOffset = e.clientY - rect.top
    const clickTime = yOffsetToTime(yOffset)

    // Double-click creates a 15-min event
    const endTime = new Date(clickTime.getTime() + 15 * 60 * 1000)
    onTimeSlotClick(date, clickTime, endTime)
  }

  // ---- Drag preview calculation ----

  function computeDragPreview() {
    if (!dragCreate || !isDraggingRef.current) return null
    const minY = Math.min(dragCreate.startY, dragCreate.currentY)
    const maxY = Math.max(dragCreate.startY, dragCreate.currentY)
    const distance = Math.abs(dragCreate.currentY - dragCreate.startY)
    if (distance <= DRAG_THRESHOLD) return null

    const previewStart = yOffsetToTime(minY)
    const previewEnd = yOffsetToTime(maxY)
    if (previewEnd.getTime() <= previewStart.getTime()) {
      previewEnd.setTime(previewStart.getTime() + 15 * 60 * 1000)
    }

    const label = `${format(previewStart, 'h:mm a')} - ${format(previewEnd, 'h:mm a')}`
    return { top: minY, height: maxY - minY, label }
  }

  const dragPreview = computeDragPreview()

  const hours: number[] = []
  for (let h = startHour; h < endHour; h++) {
    hours.push(h)
  }

  const dayColumnDate = format(date, 'yyyy-MM-dd')

  return (
    <div
      ref={combinedRef}
      data-day-column={dayColumnDate}
      className={cn(
        'relative flex-1 min-w-0',
        'border-l border-[var(--border)]',
        isOver && 'bg-[var(--surface-hover)]',
        dragCreate && isDraggingRef.current && 'select-none'
      )}
      style={{ height: totalHeight }}
      onClick={handleColumnClick}
      onDoubleClick={handleColumnDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {hours.map((hour) => (
        <React.Fragment key={hour}>
          <div
            className="absolute left-0 right-0 border-t border-[var(--border)] opacity-50"
            style={{ top: (hour - startHour) * hourHeight }}
          />
          <div
            className="absolute left-0 right-0 border-t border-[var(--border)] opacity-25"
            style={{
              top: (hour - startHour) * hourHeight + hourHeight / 2,
              borderStyle: 'dashed',
            }}
          />
        </React.Fragment>
      ))}

      {/* Drag-to-create preview */}
      {dragPreview && (
        <div
          className="absolute left-0 right-0 z-20 pointer-events-none rounded bg-indigo-500/30 border-2 border-dashed border-indigo-500"
          style={{
            top: dragPreview.top,
            height: Math.max(dragPreview.height, 4),
          }}
        >
          <span className="absolute left-2 top-1 text-[10px] font-medium text-indigo-300">
            {dragPreview.label}
          </span>
        </div>
      )}

      {layout.map(({ item, columnIndex, totalColumns }) => {
        const top = getTimePosition(item.startTime, hourHeight, startHour)
        const bottom = getTimePosition(item.endTime, hourHeight, startHour)
        const rawHeight = bottom - top
        const height = Math.max(rawHeight, MIN_ITEM_HEIGHT)
        const widthPercent = 100 / totalColumns
        const leftPercent = columnIndex * widthPercent

        return (
          <CalendarItem
            key={item.id}
            item={item}
            hourHeight={hourHeight}
            resizeResolution={draggingResolution}
            dimPastEvents={dimPastEvents}
            style={{
              top,
              height,
              width: `calc(${widthPercent}% - 2px)`,
              left: `${leftPercent}%`,
            }}
            onItemClick={onItemClick}
            onItemDoubleClick={onItemDoubleClick}
            onItemResize={onItemResize}
            onRoutineCheckboxClick={onRoutineCheckboxClick}
            onTaskCheckboxClick={onTaskCheckboxClick}
          />
        )
      })}

      {isToday && (
        <div
          className="absolute left-0 right-0 z-30 pointer-events-none"
          style={{ top: currentTimeTop }}
        >
          <div className="relative">
            <div
              className="absolute rounded-full"
              style={{
                width: 10,
                height: 10,
                backgroundColor: '#ef4444',
                left: -5,
                top: -4,
              }}
            />
            <div
              className="absolute left-0 right-0"
              style={{
                height: 2,
                backgroundColor: '#ef4444',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
})
