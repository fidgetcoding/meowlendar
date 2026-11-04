'use client'

import { useEffect, useRef } from 'react'
import { useProfile, useUpdateProfile } from './use-profile'
import {
  useCalendarStore,
  calendarStateToSettingsPatch,
  type CalendarDisplayPatch,
} from '@/lib/stores/calendar-store'

// The store keys that mirror profile.settings — a change to any of these is
// written back. Non-display state (view, drag, selection) is ignored.
const DISPLAY_KEYS: (keyof CalendarDisplayPatch)[] = [
  'showWeekends',
  'widenCurrentDay',
  'dimPastEvents',
  'showCompletedTasks',
  'showDeclinedEvents',
  'mergeDuplicateEvents',
  'timeGridStart',
  'timeGridEnd',
  'timeDisplayResolution',
  'timeDraggingResolution',
  'limitEventsPerDay',
  'defaultTaskDuration',
]

const WRITE_BACK_DEBOUNCE_MS = 800

/**
 * Makes profile.settings the single source of truth for the calendar-store
 * display slice (#68): hydrates the store once when settings load, then
 * debounce-persists any subsequent store change back to profile.settings.
 * Mount once, high in the app tree.
 */
export function useSettingsSync() {
  const { data: profile } = useProfile()
  const { mutate: updateProfile } = useUpdateProfile()
  const hydratedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hydrate the store from persisted settings exactly once.
  useEffect(() => {
    if (hydratedRef.current) return
    if (!profile?.settings) return
    useCalendarStore.getState().hydrateFromSettings(profile.settings)
    hydratedRef.current = true
  }, [profile])

  // Write store display-slice changes back to profile.settings (debounced).
  useEffect(() => {
    const unsub = useCalendarStore.subscribe((state, prev) => {
      if (!hydratedRef.current) return
      const changed = DISPLAY_KEYS.some((k) => state[k] !== prev[k])
      if (!changed) return

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        updateProfile({
          settings: calendarStateToSettingsPatch(state),
        })
      }, WRITE_BACK_DEBOUNCE_MS)
    })

    return () => {
      unsub()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [updateProfile])
}
