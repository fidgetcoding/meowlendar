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
import { Undo2, Redo2, X } from 'lucide-react'
import type { CalendarEvent, Task, Routine } from '@poolendar/types'
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
import { taskKeys } from '@/lib/hooks/use-tasks'
import { routineKeys } from '@/lib/hooks/use-routines'
import { useSettingsSync } from '@/lib/hooks/use-settings-sync'
import { useAppKeyboard } from '@/lib/hooks/use-app-keyboard'
import { useSidebarCalendarDrop } from '@/lib/hooks/use-sidebar-calendar-drop'
import { useOnline } from '@/lib/offline/use-online'
import { cn } from '@/lib/utils'
import type { Profile } from '@poolendar/types'

const BACKGROUND_SYNC_MS = 2 * 60_000

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

/** Find an entity by id across every cached list for a query key. */
function findInCache<T extends { id: string }>(
  qc: ReturnType<typeof useQueryClient>,
  key: readonly unknown[],
  id: string
): T | undefined {
  for (const [, data] of qc.getQueriesData<T[]>({ queryKey: key })) {
    const hit = data?.find((item) => item.id === id)
    if (hit) return hit
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Undo/Redo top bar — consumes the shared engine (#72d)
// ---------------------------------------------------------------------------

function UndoBar() {
  const { undo, redo, canUndo, canRedo } = useUndoContext()
  return (
    <div className={cn('flex items-center gap-1 px-2 py-1 shrink-0', 'border-b border-[var(--border)] bg-[var(--surface)]')}>
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        className={cn(
          'flex items-center justify-center w-7 h-7 rounded transition-colors duration-150',
          canUndo
            ? 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]'
            : 'text-[var(--border)] cursor-not-allowed'
        )}
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        className={cn(
          'flex items-center justify-center w-7 h-7 rounded transition-colors duration-150',
          canRedo
            ? 'text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]'
            : 'text-[var(--border)] cursor-not-allowed'
        )}
      >
        <Redo2 size={16} />
      </button>
    </div>
  )
}

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
    if (accentColor) {
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
    toast.error("Google connected, but calendar sync failed. We'll keep trying.")
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

  const deleteSelected = useCallback(() => {
    const { selectedItemId: id, selectedItemType: type } = useCalendarStore.getState()
    if (!id || !type) return
    if (type === 'event') {
      const ev = findInCache<CalendarEvent>(queryClient, eventKeys.lists(), id)
      if (ev) undoable.deleteEvent(ev)
    } else if (type === 'task') {
      const t = findInCache<Task>(queryClient, taskKeys.lists(), id)
      if (t) undoable.deleteTask(t)
    } else {
      const r = findInCache<Routine>(queryClient, routineKeys.lists(), id)
      if (r) undoable.deleteRoutine(r)
    }
  }, [queryClient, undoable])

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
            activePanel={activePanel}
            isExpanded={sidebarExpanded}
            onToggleTasks={toggleTaskPanel}
            onCalendarView={() => setActivePanel('calendar')}
            onToggleBooking={toggleBookingPanel}
            onSettings={() => openSettings()}
            onToggleExpand={() => setSidebarExpanded((e) => !e)}
          />
        </div>

        {/* Task sidebar panel -- desktop only, hidden in board mode */}
        {showTaskSidebar && (
          <div className="hidden md:flex w-[280px] shrink-0 overflow-hidden flex-col">
            <TaskPanel />
            <div className="border-t border-[var(--border)] p-2">
              <CalendarList
                calendars={calendars}
                onToggle={(calendarId) => calendarStore.toggleCalendarVisibility(calendarId)}
                onAddAccount={() => openSettings('calendars')}
              />
            </div>
          </div>
        )}

        {/* Booking sidebar panel -- desktop only */}
        {showBookingSidebar && (
          <div className="hidden md:flex w-[280px] shrink-0 overflow-hidden flex-col">
            <BookingPanel onNewLink={() => openSettings('booking')} />
          </div>
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

        <div className="flex-1 overflow-hidden flex flex-col">
          <OfflineBanner />
          <UndoBar />
          <main className="flex-1 overflow-hidden pb-14 md:pb-0">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
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
