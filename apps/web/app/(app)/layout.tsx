'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SidebarRibbon } from '@/components/sidebar/SidebarRibbon'
import { TaskPanel } from '@/components/sidebar/TaskPanel'
import { CalendarList } from '@/components/sidebar/CalendarList'
import { CommandBar } from '@/components/command-bar/CommandBar'
import { SettingsModal, type SettingsTab } from '@/components/settings/SettingsModal'
import { BottomTabBar } from '@/components/mobile/BottomTabBar'
import { BookingPanel } from '@/components/booking/BookingPanel'
import { ShortcutOverlay } from '@/components/ShortcutOverlay'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { useUIStore } from '@/lib/stores/ui-store'
import { UndoProvider, useUndoContext } from '@/lib/undo/undo-context'
import { UndoToaster } from '@/lib/undo/undo-toaster'
import { useUndoable } from '@/lib/hooks/use-undoable'
import { useProfile } from '@/lib/hooks/use-profile'
import { useCalendars, calendarKeys } from '@/lib/hooks/use-calendars'
import { eventKeys } from '@/lib/hooks/use-events'
import { useSettingsSync } from '@/lib/hooks/use-settings-sync'
import { useAppKeyboard } from '@/lib/hooks/use-app-keyboard'
import { useSidebarCalendarDrop } from '@/lib/hooks/use-sidebar-calendar-drop'
import { useDeleteSelected } from '@/lib/hooks/use-delete-selected'
import { RoutineDeletePrompt } from '@/components/calendar/RoutineDeletePrompt'
import { useOnline } from '@/lib/offline/use-online'
import { cn } from '@/lib/utils'
import type { Profile } from '@poolendar/types'

const BACKGROUND_SYNC_MS = 2 * 60_000

// Defaults, not choices: the pre-redesign defaults and the brand periwinkle itself. These leave
// the theme's own periwinkle in place, which is tuned separately for light and dark.
const DEFAULT_ACCENTS = new Set(['#6366f1', '#f9a825', '#6f7ae0', '#515dcb'])

// ---------------------------------------------------------------------------
// Offline banner
// ---------------------------------------------------------------------------

function OfflineBanner() {
  const { isOnline, wasOffline } = useOnline()
  const [showReconnected, setShowReconnected] = useState(false)

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true)
      const timer = setTimeout(() => setShowReconnected(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isOnline, wasOffline])

  if (!isOnline) {
    return (
      <div
        className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium shrink-0"
        style={{ backgroundColor: '#92400e', color: '#fef3c7' }}
      >
        <span className="w-2 h-2 rounded-full bg-yellow-300 animate-pulse" />
        You are offline. Changes will sync when reconnected.
      </div>
    )
  }

  if (showReconnected) {
    return (
      <div
        className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium shrink-0 transition-opacity duration-1000"
        style={{ backgroundColor: '#065f46', color: '#d1fae5' }}
      >
        <span className="w-2 h-2 rounded-full bg-green-300" />
        Back online. Syncing...
      </div>
    )
  }

  return null
}

type MobileTab = 'calendar' | 'tasks' | 'kanban' | 'booking' | 'settings'

// ---------------------------------------------------------------------------
// App chrome — everything inside the undo provider
// ---------------------------------------------------------------------------

function AppChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const [commandBarSearch, setCommandBarSearch] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('calendar')
  const [mobileTaskPanelOpen, setMobileTaskPanelOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const calendarStore = useCalendarStore()
  const setAllCalendarsVisible = useCalendarStore((s) => s.setAllCalendarsVisible)
  const activePanel = useUIStore((s) => s.activePanel)
  const taskPanelViewMode = useUIStore((s) => s.taskPanelViewMode)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const toggleTaskPanel = useUIStore((s) => s.toggleTaskPanel)
  const toggleBookingPanel = useUIStore((s) => s.toggleBookingPanel)
  const setTaskPanelViewMode = useUIStore((s) => s.setTaskPanelViewMode)
  const openEditForm = useUIStore((s) => s.openEditForm)
  const setActiveSettingsPanel = useUIStore((s) => s.setActiveSettingsPanel)

  const undoContext = useUndoContext()
  const undoable = useUndoable()
  const { activeDragId, handleDragStart, handleDragEnd } = useSidebarCalendarDrop()

  const { data: profileData } = useProfile()
  const { data: calendars = [] } = useCalendars()
  useSettingsSync()

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) setProfile(data as Profile)
    }
    loadProfile()
  }, [supabase, router])

  useEffect(() => {
    if (calendars.length > 0) {
      setAllCalendarsVisible(calendars.map((c) => c.id))
    }
  }, [calendars, setAllCalendarsVisible])

  const accentColor = profileData?.settings?.theme_accent_color ?? profile?.settings?.theme_accent_color
  useEffect(() => {
    // Any colour the user picked wins; the defaults keep the theme's periwinkle.
    if (accentColor && !DEFAULT_ACCENTS.has(accentColor.toLowerCase())) {
      document.documentElement.style.setProperty('--accent-color', accentColor)
      document.documentElement.style.setProperty('--accent', accentColor)
    }
  }, [accentColor])

  // --- App-level command / keyboard handlers ---
  const openSettings = useCallback((tab?: SettingsTab) => {
    setSettingsTab(tab)
    if (tab) setActiveSettingsPanel(tab === 'calendars' ? 'calendars' : 'general')
    setSettingsOpen(true)
  }, [setActiveSettingsPanel])

  const refreshCalendars = useCallback(() => {
    fetch('/api/google/sync', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: calendarKeys.all })
        queryClient.invalidateQueries({ queryKey: eventKeys.all })
      })
  }, [queryClient])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('google_sync') !== 'failed') return
    toast.error("Google authorization finished, but calendar sync failed. Check Settings → Calendars.")
    url.searchParams.delete('google_sync')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  // While the app is open it keeps itself in sync. This is what covers a deployment
  // whose scheduled job only runs daily, like Vercel's free plan.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refreshCalendars()
    }
    tick()
    const timer = setInterval(tick, BACKGROUND_SYNC_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refreshCalendars])

  const deleteSelected = useDeleteSelected()

  const splitSelected = useCallback(() => {
    const { selectedItemId: id, selectedItemType: type } = useCalendarStore.getState()
    if (id && type === 'task') undoable.splitTask(id)
  }, [undoable])

  useAppKeyboard({
    undo: undoContext.undo,
    redo: undoContext.redo,
    toggleCommandBar: () => {
      setCommandBarSearch(false)
      setCommandBarOpen((o) => !o)
    },
    openCommandSearch: () => {
      setCommandBarSearch(true)
      setCommandBarOpen(true)
    },
    closeCommandBar: () => setCommandBarOpen(false),
    openSettings: () => openSettings(),
    refreshCalendars,
    showShortcuts: () => setShortcutsOpen(true),
    deleteSelected,
    splitSelected,
  })

  function handleMobileTab(tab: MobileTab) {
    setMobileTab(tab)
    if (tab === 'tasks') {
      setMobileTaskPanelOpen(true)
      setActivePanel('tasks')
    } else if (tab === 'kanban') {
      setActivePanel('tasks')
      useUIStore.getState().setTaskPanelViewMode('board')
    } else if (tab === 'booking') {
      setActivePanel('booking')
    } else if (tab === 'settings') {
      setSettingsOpen(true)
    } else {
      setActivePanel('calendar')
      setMobileTaskPanelOpen(false)
    }
  }

  const showTaskSidebar = activePanel === 'tasks' && taskPanelViewMode !== 'board'
  const showBookingSidebar = activePanel === 'booking'

  // The ribbon highlights what fills the main area: the board under Tasks, the week under Calendar.
  const activeNav = showBookingSidebar ? 'booking' : taskPanelViewMode === 'board' ? 'tasks' : 'calendar'

  // Calendar: the week, with its task panel open on the right.
  const showCalendarView = useCallback(() => {
    setTaskPanelViewMode('sidebar')
    setActivePanel('tasks')
  }, [setActivePanel, setTaskPanelViewMode])

  // Tasks: the full board; pressing it again goes back to the week.
  const toggleBoard = useCallback(() => {
    if (taskPanelViewMode === 'board' && !showBookingSidebar) {
      showCalendarView()
      return
    }
    if (showBookingSidebar) setActivePanel('tasks')
    setTaskPanelViewMode('board')
  }, [taskPanelViewMode, showBookingSidebar, showCalendarView, setActivePanel, setTaskPanelViewMode])

  return (
    <DndContext
      id="calendar-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-screen bg-[var(--bg)]">
        {/* Desktop ribbon */}
        <div className="hidden md:flex">
          <SidebarRibbon
            activePanel={activeNav}
            isExpanded={sidebarExpanded}
            onToggleTasks={toggleBoard}
            onCalendarView={showCalendarView}
            onToggleBooking={toggleBookingPanel}
            onSettings={() => openSettings()}
            onToggleExpand={() => setSidebarExpanded((e) => !e)}
          />
        </div>

        {/* Booking panel on the left, beside the ribbon (like Morgen) -- desktop only */}
        {showBookingSidebar && (
          <aside className="meow-bpanel hidden md:flex" aria-label="Booking">
            <BookingPanel onNewLink={() => openSettings('booking')} />
          </aside>
        )}

        {/* Mobile task panel -- full-screen overlay */}
        {mobileTaskPanelOpen && (
          <div
            className={cn(
              'fixed inset-0 z-40 flex flex-col md:hidden',
              'bg-[var(--bg)]',
              'animate-in slide-in-from-bottom duration-300'
            )}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
              <div className="flex-1 flex justify-center">
                <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileTaskPanelOpen(false)
                  setMobileTab('calendar')
                }}
                aria-label="Close task panel"
                className="absolute right-3 top-3 p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <TaskPanel
                onTaskClick={(id) => {
                  openEditForm(id, 'task')
                  setMobileTaskPanelOpen(false)
                  setMobileTab('calendar')
                }}
              />
            </div>
          </div>
        )}

        {/* Mobile booking panel -- full-screen overlay */}
        {showBookingSidebar && (
          <div
            className={cn(
              'fixed inset-0 z-40 flex flex-col md:hidden',
              'bg-[var(--bg)] animate-in slide-in-from-bottom duration-300'
            )}
          >
            <div className="flex items-center justify-end px-3 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
              <button
                type="button"
                onClick={() => {
                  setActivePanel('calendar')
                  setMobileTab('calendar')
                }}
                aria-label="Close booking panel"
                className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <BookingPanel onNewLink={() => openSettings('booking')} />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          <OfflineBanner />
          <main className="flex-1 overflow-hidden pb-14 md:pb-0">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>

        {/* Task panel on the right -- desktop only, open by default, hidden in board mode */}
        {showTaskSidebar && (
          <aside className="meow-panel hidden md:flex" aria-label="Tasks">
            <TaskPanel onHide={toggleTaskPanel}>
              <CalendarList
                calendars={calendars}
                onToggle={(calendarId) => calendarStore.toggleCalendarVisibility(calendarId)}
                onAddAccount={() => openSettings('calendars')}
              />
            </TaskPanel>
          </aside>
        )}

      </div>

      <BottomTabBar activeTab={mobileTab} onTabChange={handleMobileTab} />

      <CommandBar
        open={commandBarOpen}
        onOpenChange={setCommandBarOpen}
        onOpenSettings={(tab) => {
          setCommandBarOpen(false)
          openSettings(tab as SettingsTab | undefined)
        }}
        onRefreshCalendars={refreshCalendars}
        onShowShortcuts={() => {
          setCommandBarOpen(false)
          setShortcutsOpen(true)
        }}
        startInSearch={commandBarSearch}
      />

      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <RoutineDeletePrompt />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        profile={profile}
        onProfileUpdate={setProfile}
        initialTab={settingsTab}
      />

      <DragOverlay>
        {activeDragId ? (
          <div className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--fg)] shadow-lg">
            Moving...
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ---------------------------------------------------------------------------
// AppLayout — mounts the shared undo engine, then the chrome
// ---------------------------------------------------------------------------

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: profile } = useProfile()
  const graceSeconds = profile?.settings?.undo_grace_period_seconds ?? 30

  return (
    <UndoProvider gracePeriodMs={graceSeconds * 1000}>
      <UndoToaster />
      <AppChrome>{children}</AppChrome>
    </UndoProvider>
  )
}
