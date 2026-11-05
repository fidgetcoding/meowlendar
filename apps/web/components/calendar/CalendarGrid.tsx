'use client'

import * as React from 'react'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { addDays, endOfDay, format, isToday, getDay, getISOWeek, startOfDay } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEvent, Task, Routine, Calendar } from '@poolendar/types'
import type { CalendarItemData, CalendarItemType } from './calendar-types'
import { TimeColumn } from './TimeColumn'
import { DayColumn } from './DayColumn'
import { CalendarDragOverlay } from './CalendarDragOverlay'
import { MonthGrid } from './MonthGrid'
import { NewItemPopover } from './NewItemPopover'
import { getReadableTextColor } from './event-color'
import { eventsToItems, tasksToItems, routinesToItems } from './grid-items'
import {
  getVisibleDays,
  filterWeekends,
  isAllDayRowItem,
  clampItemToDay,
  itemOverlapsDay,
  mergeDuplicateEventItems,
  isDeclinedEvent,
  type GridView,
} from './grid-helpers'
import { useCalendarRoutineInstances } from '@/lib/hooks/use-routines'
import { useUIStore } from '@/lib/stores/ui-store'

interface CalendarGridProps {
  view: GridView
  currentDate: Date
  customDays?: number
  events: CalendarEvent[]
  tasks: Task[]
  routines: Routine[]
  calendars: Calendar[]
  hourHeight?: number
  startHour?: number
  endHour?: number
  draggingResolution?: number
  limitPerDay?: number
  widenCurrentDay?: boolean
  dimPastEvents?: boolean
  showWeekends?: boolean
  showCompletedTasks?: boolean
  showDeclinedEvents?: boolean
  mergeDuplicateEvents?: boolean
  showWeekNumbers?: boolean
  /** Connected-account emails — used to detect declined events (#5). */
  selfEmails?: string[]
  itemPreviewOpen?: boolean
  onItemClick?: (item: CalendarItemData, anchorRect?: DOMRect) => void
  onItemDoubleClick?: (item: CalendarItemData) => void
  onTimeSlotClick?: (date: Date, time: Date) => void
  onItemReschedule?: (
    itemId: string,
    itemType: CalendarItemType,
    newStart: Date,
    newEnd: Date
  ) => void
  onItemResize?: (
    itemId: string,
    itemType: CalendarItemType,
    newEnd: Date
  ) => void
  onQuickCreate?: (
    title: string,
    type: CalendarItemType,
    startTime: Date,
    endTime?: Date
  ) => void
  onOpenFullForm?: (
    type: CalendarItemType,
    date: Date,
    startTime: Date,
    endTime?: Date
  ) => void
  onRoutineCheckboxClick?: (item: CalendarItemData) => void
  onTaskCheckboxClick?: (item: CalendarItemData) => void
}

const DEFAULT_HOUR_HEIGHT = 60
const SCROLL_TO_HOUR = 8

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarGrid({
  view,
  currentDate,
  customDays = 3,
  events,
  tasks,
  routines,
  calendars,
  hourHeight = DEFAULT_HOUR_HEIGHT,
  startHour = 0,
  endHour = 24,
  draggingResolution = 15,
  limitPerDay,
  widenCurrentDay = false,
  dimPastEvents = false,
  showWeekends = true,
  showCompletedTasks = true,
  showDeclinedEvents = false,
  mergeDuplicateEvents = false,
  showWeekNumbers = false,
  selfEmails = [],
  itemPreviewOpen = false,
  onItemClick,
  onItemDoubleClick,
  onTimeSlotClick,
  onItemReschedule,
  onItemResize,
  onQuickCreate,
  onOpenFullForm,
  onRoutineCheckboxClick,
  onTaskCheckboxClick,
}: CalendarGridProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const dismissingPopoverRef = React.useRef(false)
  const [activeItem, setActiveItem] = React.useState<Active | null>(null)
  const [popoverState, setPopoverState] = React.useState<{
    date: Date
    startTime: Date
    endTime?: Date
    anchorRect: DOMRect
  } | null>(null)
  const uiStore = useUIStore()

  function handleGridContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const itemEl = (e.target as HTMLElement).closest('[data-calendar-item]')
    if (itemEl) {
      const itemId = itemEl.getAttribute('data-item-id') ?? undefined
      const itemType = itemEl.getAttribute('data-item-type') as 'event' | 'task' | 'routine' | null
      if (itemId && itemType) {
        uiStore.openContextMenu(itemId, itemType, { x: e.clientX, y: e.clientY })
        return
      }
    }
    uiStore.openContextMenu(null, null, { x: e.clientX, y: e.clientY })
  }

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 5 },
  })
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 300, tolerance: 5 },
  })
  const sensors = useSensors(mouseSensor, touchSensor)

  const visibleDays = React.useMemo(() => {
    const raw = getVisibleDays(currentDate, view, customDays)
    // Weekend hiding only applies to multi-day, non-month layouts (month keeps
    // its fixed 7-column grid).
    if (!showWeekends && view !== 'day' && view !== 'month') {
      return filterWeekends(raw)
    }
    return raw
  }, [currentDate, view, customDays, showWeekends])

  // Include neighbouring host dates even across the largest UTC offsets.
  const { data: routineInstances } = useCalendarRoutineInstances(
    format(addDays(visibleDays[0] ?? currentDate, -2), 'yyyy-MM-dd'),
    format(addDays(visibleDays[visibleDays.length - 1] ?? currentDate, 2), 'yyyy-MM-dd'),
    routines.length > 0,
  )
  const allItems = React.useMemo(() => {
    const windowStart = startOfDay(visibleDays[0] ?? currentDate)
    const windowEnd = endOfDay(visibleDays[visibleDays.length - 1] ?? currentDate)
    let eventItems = eventsToItems(events, calendars, { start: windowStart, end: windowEnd })
    if (!showDeclinedEvents) {
      eventItems = eventItems.filter(
        (i) => !(i.event && isDeclinedEvent(i.event, selfEmails))
      )
    }

    let taskItems = tasksToItems(tasks, calendars)
    if (!showCompletedTasks) {
      taskItems = taskItems.filter((i) => i.task?.status !== 'done')
    }

    const routineItems = routinesToItems(routines, visibleDays, calendars, routineInstances)

    let combined = [...eventItems, ...taskItems, ...routineItems]
    if (mergeDuplicateEvents) {
      combined = mergeDuplicateEventItems(combined)
    }
    return combined
  }, [currentDate, 
    events,
    tasks,
    routines,
    routineInstances,
    calendars,
    visibleDays,
    showDeclinedEvents,
    showCompletedTasks,
    mergeDuplicateEvents,
    selfEmails,
  ])

  const allDayRowItems = React.useMemo(
    () => allItems.filter(isAllDayRowItem),
    [allItems]
  )
  const timedItems = React.useMemo(
    () => allItems.filter((i) => !isAllDayRowItem(i)),
    [allItems]
  )

  React.useEffect(() => {
    if (view === 'month') return
    if (!scrollRef.current) return
    const scrollTarget = Math.max(0, SCROLL_TO_HOUR - startHour) * hourHeight
    scrollRef.current.scrollTop = scrollTarget
  }, [view, hourHeight, currentDate, startHour])

  function handleDragStart(event: DragStartEvent) {
    setActiveItem(event.active)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null)

    const { active, over } = event
    if (!over) return

    const draggedItem = active.data?.current?.item as CalendarItemData | undefined
    if (!draggedItem) return

    const dropData = over.data?.current as { type?: string; date?: Date } | undefined
    if (!dropData || dropData.type !== 'day-column' || !dropData.date) return

    const dropDate = dropData.date
    const durationMs = draggedItem.endTime.getTime() - draggedItem.startTime.getTime()

    let newHours = draggedItem.startTime.getHours()
    let newMinutes = draggedItem.startTime.getMinutes()

    if (event.delta) {
      const deltaMinutes =
        Math.round((event.delta.y / hourHeight) * 60 / draggingResolution) *
        draggingResolution
      const totalMinutes =
        draggedItem.startTime.getHours() * 60 +
        draggedItem.startTime.getMinutes() +
        deltaMinutes
      newHours = Math.max(0, Math.min(23, Math.floor(totalMinutes / 60)))
      newMinutes = Math.max(0, totalMinutes % 60)
    }

    const newStart = new Date(dropDate)
    newStart.setHours(newHours, newMinutes, 0, 0)
    const newEnd = new Date(newStart.getTime() + durationMs)

    onItemReschedule?.(draggedItem.id, draggedItem.type, newStart, newEnd)
  }

  function handleTimeSlotClick(date: Date, time: Date, endTime?: Date) {
    if (dismissingPopoverRef.current) {
      dismissingPopoverRef.current = false
      return
    }
    if (onTimeSlotClick) {
      onTimeSlotClick(date, time)
    }

    const el = scrollRef.current
    if (!el) return

    const top = (time.getHours() + time.getMinutes() / 60 - startHour) * hourHeight
    const rect = el.getBoundingClientRect()
    const anchorRect = new DOMRect(
      rect.left + rect.width / 2,
      rect.top + top - el.scrollTop,
      1,
      hourHeight / 2
    )

    setPopoverState({ date, startTime: time, endTime, anchorRect })
  }

  function handlePopoverClose() {
    setPopoverState(null)
  }

  function handleQuickCreate(title: string, type: CalendarItemType) {
    if (title.trim() && popoverState) {
      onQuickCreate?.(title.trim(), type, popoverState.startTime, popoverState.endTime)
    }
    setPopoverState(null)
  }

  function handleOpenFullForm(_title: string, type: CalendarItemType) {
    if (popoverState) {
      onOpenFullForm?.(
        type,
        popoverState.date,
        popoverState.startTime,
        popoverState.endTime
      )
    }
    setPopoverState(null)
  }

  function dayFlexGrow(day: Date): number {
    return widenCurrentDay && isToday(day) ? 1.6 : 1
  }

  if (view === 'month') {
    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div onContextMenu={handleGridContextMenu} className="flex flex-col flex-1 overflow-hidden">
          <MonthGrid
            currentDate={currentDate}
            visibleDays={visibleDays}
            items={allItems}
            limitPerDay={limitPerDay}
            onItemClick={onItemClick}
            onItemDoubleClick={onItemDoubleClick}
          />
        </div>
        <CalendarDragOverlay active={activeItem} />
      </DndContext>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden" onContextMenu={handleGridContextMenu}>
        <WeekHeader
          days={visibleDays}
          showWeekNumbers={showWeekNumbers}
          widenCurrentDay={widenCurrentDay}
        />

        {/* All-day / multi-day events row (#15d) */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="shrink-0 w-10 md:w-[60px] px-1 md:px-2 py-1 text-[10px] md:text-[11px] text-[var(--muted)]">
            all-day
          </div>
          <div className="flex flex-1">
            {visibleDays.map((day) => {
              const dayAllDay = allDayRowItems.filter((item) => itemOverlapsDay(item, day))
              return (
                <div
                  key={day.toISOString()}
                  className="min-w-0 min-h-[28px] p-1 border-l"
                  style={{ borderColor: 'var(--border)', flexGrow: dayFlexGrow(day), flexBasis: 0 }}
                >
                  {dayAllDay.map((item) => (
                    <div
                      key={item.id}
                      data-calendar-item
                      data-item-id={item.id}
                      data-item-type={item.type}
                      className="text-xs px-2 py-0.5 rounded mb-0.5 cursor-pointer truncate"
                      style={{ backgroundColor: item.color || 'var(--accent)', color: getReadableTextColor(item.color) }}
                      onClick={(e) =>
                        onItemClick?.(item, (e.currentTarget as HTMLElement).getBoundingClientRect())
                      }
                      onDoubleClick={() => onItemDoubleClick?.(item)}
                    >
                      {item.title}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        <div
          ref={scrollRef}
          onMouseDownCapture={() => { dismissingPopoverRef.current = popoverState !== null || itemPreviewOpen }}
          className="flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div className="flex min-h-0">
            <TimeColumn hourHeight={hourHeight} startHour={startHour} endHour={endHour} />

            {visibleDays.map((day) => {
              const dayItems = timedItems
                .filter((item) => itemOverlapsDay(item, day))
                .map((item) => clampItemToDay(item, day))
              return (
                <div
                  key={day.toISOString()}
                  className="flex min-w-0"
                  style={{ flexGrow: dayFlexGrow(day), flexBasis: 0 }}
                >
                  <DayColumn
                    date={day}
                    items={dayItems}
                    hourHeight={hourHeight}
                    startHour={startHour}
                    endHour={endHour}
                    draggingResolution={draggingResolution}
                    dimPastEvents={dimPastEvents}
                    isToday={isToday(day)}
                    onTimeSlotClick={handleTimeSlotClick}
                    onItemClick={onItemClick}
                    onItemDoubleClick={onItemDoubleClick}
                    onItemResize={onItemResize}
                    onRoutineCheckboxClick={onRoutineCheckboxClick}
                    onTaskCheckboxClick={onTaskCheckboxClick}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <CalendarDragOverlay active={activeItem} />

      {popoverState && (
        <NewItemPopover
          date={popoverState.date}
          startTime={popoverState.startTime}
          endTime={popoverState.endTime}
          anchorRect={popoverState.anchorRect}
          onClose={handlePopoverClose}
          onQuickCreate={handleQuickCreate}
          onOpenFullForm={handleOpenFullForm}
        />
      )}
    </DndContext>
  )
}

// ---------------------------------------------------------------------------
// Week header sub-component
// ---------------------------------------------------------------------------

interface WeekHeaderProps {
  days: Date[]
  showWeekNumbers?: boolean
  widenCurrentDay?: boolean
}

function WeekHeader({ days, showWeekNumbers = false, widenCurrentDay = false }: WeekHeaderProps) {
  const weekNumber = days.length > 0 ? getISOWeek(days[0]!) : null

  return (
    <div className="flex border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="shrink-0 flex items-center justify-center w-10 md:w-[60px]">
        {showWeekNumbers && weekNumber !== null && (
          <span
            className="text-[10px] font-medium text-[var(--muted)]"
            title={`Week ${weekNumber}`}
          >
            W{weekNumber}
          </span>
        )}
      </div>

      {days.map((day) => {
        const today = isToday(day)
        const dayNum = format(day, 'd')
        const dayName = DAY_NAMES[getDay(day)]

        return (
          <div
            key={day.toISOString()}
            className={cn(
              'min-w-0 flex flex-col items-center py-2',
              'border-l border-[var(--border)]'
            )}
            style={{ flexGrow: widenCurrentDay && today ? 1.6 : 1, flexBasis: 0 }}
          >
            <span
              className={cn(
                'text-xs font-medium uppercase',
                today ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
              )}
            >
              {dayName}
            </span>

            <span
              className={cn(
                'flex items-center justify-center mt-0.5',
                'w-7 h-7 rounded-full text-sm font-semibold',
                today
                  ? 'bg-[var(--accent)] text-[var(--bg)]'
                  : 'text-[var(--fg)]'
              )}
            >
              {dayNum}
            </span>
          </div>
        )
      })}
    </div>
  )
}
