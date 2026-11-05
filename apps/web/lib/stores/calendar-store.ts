'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays, addMonths, subMonths, format } from 'date-fns'
import type { UserSettings } from '@poolendar/types'

type CalendarView = 'day' | 'week' | 'month' | '2weeks' | 'custom'

interface DragState {
  isDragging: boolean
  dragType: 'move' | 'resize' | 'create' | null
  dragItemId: string | null
  dragStartTime: string | null
  dragCurrentTime: string | null
  dragStartDate: string | null
  dragCurrentDate: string | null
}

const initialDragState: DragState = {
  isDragging: false,
  dragType: null,
  dragItemId: null,
  dragStartTime: null,
  dragCurrentTime: null,
  dragStartDate: null,
  dragCurrentDate: null,
}

interface CalendarState {
  // View state
  view: CalendarView
  customDays: number
  selectedDate: string

  // Selection
  selectedItemId: string | null
  selectedItemType: 'event' | 'task' | 'routine' | null
  /** The day of a selected routine occurrence (YYYY-MM-DD), so the Delete key can offer scope. */
  selectedOccurrenceDate: string | null

  // Visible calendars
  visibleCalendarIds: Set<string>
  soloCalendarId: string | null

  // Zoom
  hourHeight: number

  // Display settings (persisted)
  showWeekends: boolean
  widenCurrentDay: boolean
  dimPastEvents: boolean
  showCompletedTasks: boolean
  showDeclinedEvents: boolean
  mergeDuplicateEvents: boolean

  // Time-grid config sourced from profile.settings (#6, #8, #9a, #14)
  timeGridStart: number // hour 0-24
  timeGridEnd: number // hour 0-24
  timeDisplayResolution: number // minutes
  timeDraggingResolution: number // minutes
  limitEventsPerDay: number
  defaultTaskDuration: number // minutes

  // Drag state
  drag: DragState

  // Actions
  setView: (view: CalendarView) => void
  setCustomDays: (days: number) => void
  setSelectedDate: (date: string) => void
  goToToday: () => void
  goToPrevPeriod: () => void
  goToNextPeriod: () => void
  selectItem: (id: string | null, type: 'event' | 'task' | 'routine' | null, occurrenceDate?: string | null) => void
  clearSelection: () => void
  toggleCalendarVisibility: (calendarId: string) => void
  setAllCalendarsVisible: (ids: string[]) => void
  soloCalendar: (calendarId: string | null) => void
  zoomIn: () => void
  zoomOut: () => void
  setHourHeight: (height: number) => void
  setShowWeekends: (show: boolean) => void
  setWidenCurrentDay: (widen: boolean) => void
  setDimPastEvents: (dim: boolean) => void
  setShowCompletedTasks: (show: boolean) => void
  setShowDeclinedEvents: (show: boolean) => void
  setMergeDuplicateEvents: (merge: boolean) => void
  setTimeGrid: (startHour: number, endHour: number) => void
  setTimeDisplayResolution: (minutes: number) => void
  setTimeDraggingResolution: (minutes: number) => void
  setLimitEventsPerDay: (n: number) => void
  setDefaultTaskDuration: (minutes: number) => void
  hydrateFromSettings: (settings: Partial<UserSettings>) => void
  startDrag: (drag: Omit<DragState, 'isDragging'>) => void
  updateDrag: (time: string, date: string) => void
  endDrag: () => void
}

function navigateDate(
  currentDate: string,
  view: CalendarView,
  customDays: number,
  direction: 'prev' | 'next'
): string {
  const date = new Date(currentDate + 'T00:00:00')
  const sign = direction === 'next' ? 1 : -1

  switch (view) {
    case 'day':
      return format(addDays(date, sign * 1), 'yyyy-MM-dd')
    case 'week':
      return format(addDays(date, sign * 7), 'yyyy-MM-dd')
    case 'month':
      return format(
        direction === 'next' ? addMonths(date, 1) : subMonths(date, 1),
        'yyyy-MM-dd'
      )
    case '2weeks':
      return format(addDays(date, sign * 14), 'yyyy-MM-dd')
    case 'custom':
      return format(addDays(date, sign * customDays), 'yyyy-MM-dd')
  }
}

const MIN_HOUR_HEIGHT = 30
const MAX_HOUR_HEIGHT = 120
const ZOOM_STEP = 15

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      // View state
      view: 'week',
      customDays: 3,
      selectedDate: format(new Date(), 'yyyy-MM-dd'),

      // Selection
      selectedItemId: null,
      selectedItemType: null,
      selectedOccurrenceDate: null,

      // Visible calendars
      visibleCalendarIds: new Set<string>(),
      soloCalendarId: null,

      // Zoom
      hourHeight: 60,

      // Display settings — defaults per PRODUCT.md #5
      showWeekends: true,
      widenCurrentDay: true,
      dimPastEvents: true,
      showCompletedTasks: true,
      showDeclinedEvents: false,
      mergeDuplicateEvents: true,

      // Time-grid config defaults (#68)
      timeGridStart: 0,
      timeGridEnd: 24,
      timeDisplayResolution: 15,
      timeDraggingResolution: 15,
      limitEventsPerDay: 4,
      defaultTaskDuration: 30,

      // Drag state
      drag: { ...initialDragState },

      // Actions
      setView: (view) => set({ view }),

      setCustomDays: (days) =>
        set({ customDays: Math.max(1, Math.min(9, days)) }),

      setSelectedDate: (date) => set({ selectedDate: date }),

      goToToday: () => set({ selectedDate: format(new Date(), 'yyyy-MM-dd') }),

      goToPrevPeriod: () => {
        const { selectedDate, view, customDays } = get()
        set({ selectedDate: navigateDate(selectedDate, view, customDays, 'prev') })
      },

      goToNextPeriod: () => {
        const { selectedDate, view, customDays } = get()
        set({ selectedDate: navigateDate(selectedDate, view, customDays, 'next') })
      },

      selectItem: (id, type, occurrenceDate = null) =>
        set({ selectedItemId: id, selectedItemType: type, selectedOccurrenceDate: occurrenceDate }),

      clearSelection: () =>
        set({ selectedItemId: null, selectedItemType: null, selectedOccurrenceDate: null }),

      toggleCalendarVisibility: (calendarId) =>
        set((state) => {
          const next = new Set(state.visibleCalendarIds)
          if (next.has(calendarId)) {
            next.delete(calendarId)
          } else {
            next.add(calendarId)
          }
          return { visibleCalendarIds: next, soloCalendarId: null }
        }),

      setAllCalendarsVisible: (ids) =>
        set({ visibleCalendarIds: new Set(ids), soloCalendarId: null }),

      soloCalendar: (calendarId) =>
        set((state) => {
          if (calendarId === null || state.soloCalendarId === calendarId) {
            return { soloCalendarId: null }
          }
          return { soloCalendarId: calendarId }
        }),

      zoomIn: () =>
        set((state) => ({
          hourHeight: Math.min(MAX_HOUR_HEIGHT, state.hourHeight + ZOOM_STEP),
        })),

      zoomOut: () =>
        set((state) => ({
          hourHeight: Math.max(MIN_HOUR_HEIGHT, state.hourHeight - ZOOM_STEP),
        })),

      setHourHeight: (height) =>
        set({
          hourHeight: Math.max(MIN_HOUR_HEIGHT, Math.min(MAX_HOUR_HEIGHT, height)),
        }),

      setShowWeekends: (show) => set({ showWeekends: show }),
      setWidenCurrentDay: (widen) => set({ widenCurrentDay: widen }),
      setDimPastEvents: (dim) => set({ dimPastEvents: dim }),
      setShowCompletedTasks: (show) => set({ showCompletedTasks: show }),
      setShowDeclinedEvents: (show) => set({ showDeclinedEvents: show }),
      setMergeDuplicateEvents: (merge) => set({ mergeDuplicateEvents: merge }),

      setTimeGrid: (startHour, endHour) =>
        set({
          timeGridStart: Math.max(0, Math.min(23, Math.floor(startHour))),
          timeGridEnd: Math.max(1, Math.min(24, Math.ceil(endHour))),
        }),
      setTimeDisplayResolution: (minutes) =>
        set({ timeDisplayResolution: Math.max(5, Math.min(60, minutes)) }),
      setTimeDraggingResolution: (minutes) =>
        set({ timeDraggingResolution: Math.max(5, Math.min(60, minutes)) }),
      setLimitEventsPerDay: (n) =>
        set({ limitEventsPerDay: Math.max(1, Math.min(20, Math.floor(n))) }),
      setDefaultTaskDuration: (minutes) =>
        set({ defaultTaskDuration: Math.max(5, minutes) }),

      hydrateFromSettings: (settings) =>
        set(settingsToCalendarPatch(settings)),

      startDrag: (drag) => set({ drag: { ...drag, isDragging: true } }),

      updateDrag: (time, date) =>
        set((state) => ({
          drag: { ...state.drag, dragCurrentTime: time, dragCurrentDate: date },
        })),

      endDrag: () => set({ drag: { ...initialDragState } }),
    }),
    {
      name: 'poolendar-calendar-store',
      partialize: (state) => ({
        view: state.view,
        customDays: state.customDays,
        hourHeight: state.hourHeight,
        showWeekends: state.showWeekends,
        widenCurrentDay: state.widenCurrentDay,
        dimPastEvents: state.dimPastEvents,
        showCompletedTasks: state.showCompletedTasks,
        showDeclinedEvents: state.showDeclinedEvents,
        mergeDuplicateEvents: state.mergeDuplicateEvents,
        timeGridStart: state.timeGridStart,
        timeGridEnd: state.timeGridEnd,
        timeDisplayResolution: state.timeDisplayResolution,
        timeDraggingResolution: state.timeDraggingResolution,
        limitEventsPerDay: state.limitEventsPerDay,
        defaultTaskDuration: state.defaultTaskDuration,
      }),
    }
  )
)

// ---------------------------------------------------------------------------
// Settings <-> calendar-store mapping (pure, testable)
//
// profile.settings (UserSettings) is the single source of truth (#68). These
// helpers translate between the persisted settings shape and the store's
// display/time slice so hydration and write-back stay symmetric.
// ---------------------------------------------------------------------------

export interface CalendarDisplayPatch {
  showWeekends: boolean
  widenCurrentDay: boolean
  dimPastEvents: boolean
  showCompletedTasks: boolean
  showDeclinedEvents: boolean
  mergeDuplicateEvents: boolean
  timeGridStart: number
  timeGridEnd: number
  timeDisplayResolution: number
  timeDraggingResolution: number
  limitEventsPerDay: number
  defaultTaskDuration: number
}

/** Parse an "HH:mm" (or "HH:mm:ss") time string into an integer hour. */
export function parseHour(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return null
  const h = parseInt(match[1]!, 10)
  if (Number.isNaN(h)) return null
  return h
}

/** Serialize an integer hour back into an "HH:mm" string (24 -> "00:00"). */
export function hourToTimeString(hour: number): string {
  const h = hour >= 24 ? 0 : hour
  return `${String(h).padStart(2, '0')}:00`
}

/**
 * Translate the persisted UserSettings into a partial store patch. Only the
 * fields present in `settings` are applied; the rest keep their defaults.
 */
export function settingsToCalendarPatch(
  settings: Partial<UserSettings>
): Partial<CalendarDisplayPatch> {
  const patch: Partial<CalendarDisplayPatch> = {}

  if (settings.show_weekends !== undefined) patch.showWeekends = settings.show_weekends
  if (settings.widen_current_day !== undefined) patch.widenCurrentDay = settings.widen_current_day
  if (settings.dim_past_events !== undefined) patch.dimPastEvents = settings.dim_past_events
  if (settings.show_completed_tasks !== undefined) patch.showCompletedTasks = settings.show_completed_tasks
  if (settings.show_declined_events !== undefined) patch.showDeclinedEvents = settings.show_declined_events
  if (settings.merge_duplicate_events !== undefined) patch.mergeDuplicateEvents = settings.merge_duplicate_events

  const startHour = parseHour(settings.time_grid_start)
  if (startHour !== null) patch.timeGridStart = startHour
  const endHour = parseHour(settings.time_grid_end)
  if (endHour !== null) {
    // An end that parses at/below the start means "next day" (e.g. "00:00").
    patch.timeGridEnd = endHour <= (patch.timeGridStart ?? 0) ? 24 : endHour
  }

  if (settings.time_display_resolution !== undefined) patch.timeDisplayResolution = settings.time_display_resolution
  if (settings.time_drag_resolution !== undefined) patch.timeDraggingResolution = settings.time_drag_resolution
  if (settings.limit_events_per_day !== undefined) patch.limitEventsPerDay = settings.limit_events_per_day
  if (settings.default_task_duration_minutes !== undefined) patch.defaultTaskDuration = settings.default_task_duration_minutes

  return patch
}

/** Translate the store's display/time slice back into a UserSettings patch. */
export function calendarStateToSettingsPatch(
  state: CalendarDisplayPatch
): Partial<UserSettings> {
  return {
    show_weekends: state.showWeekends,
    widen_current_day: state.widenCurrentDay,
    dim_past_events: state.dimPastEvents,
    show_completed_tasks: state.showCompletedTasks,
    show_declined_events: state.showDeclinedEvents,
    merge_duplicate_events: state.mergeDuplicateEvents,
    time_grid_start: hourToTimeString(state.timeGridStart),
    time_grid_end: hourToTimeString(state.timeGridEnd),
    time_display_resolution: state.timeDisplayResolution,
    time_drag_resolution: state.timeDraggingResolution,
    limit_events_per_day: state.limitEventsPerDay,
    default_task_duration_minutes: state.defaultTaskDuration,
  }
}
