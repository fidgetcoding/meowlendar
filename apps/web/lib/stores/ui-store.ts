'use client'

import { create } from 'zustand'

interface PreviewPopover {
  isOpen: boolean
  itemId: string | null
  itemType: 'event' | 'task' | 'routine' | null
  position: { x: number; y: number } | null
}

/**
 * The panels are mutually exclusive — only one occupies the left drawer /
 * main area at a time. `activePanel` is the single source of truth; the
 * `taskPanelOpen` / `bookingPanelOpen` booleans are read-only mirrors kept in
 * sync here (never set independently) so existing consumers keep working.
 */
export type PanelId = 'tasks' | 'calendar' | 'booking' | 'schedules'

interface UIState {
  // Panel states
  sidebarOpen: boolean
  activePanel: PanelId
  taskPanelOpen: boolean
  bookingPanelOpen: boolean
  settingsModalOpen: boolean
  commandBarOpen: boolean

  // Task panel mode
  taskPanelMode: 'tasks' | 'routines'
  taskPanelViewMode: 'sidebar' | 'board'

  // Preview popover
  previewPopover: PreviewPopover

  // Edit form
  editFormOpen: boolean
  editFormItemId: string | null
  /** Which occurrences an edit of a recurring event applies to. */
  editFormScope: 'single' | 'future' | 'all' | 'custom' | null
  editFormItemType: 'event' | 'task' | 'routine' | null
  editFormTab: 'event' | 'task' | 'routine'
  /** Seed data for create-mode (e.g. the clicked time slot). */
  editFormInitialData: Record<string, unknown> | null

  // Context menu
  contextMenu: {
    isOpen: boolean
    itemId: string | null
    itemType: 'event' | 'task' | 'routine' | null
    position: { x: number; y: number } | null
  }

  // Active settings panel
  activeSettingsPanel:
    | 'shortcuts'
    | 'calendars'
    | 'video_conferencing'
    | 'telegram'
    | 'general'
    | 'active_calendars'
    | 'tags'
    | 'availability'
    | 'booking_page'
    | 'profile'

  // Actions
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setActivePanel: (panel: PanelId) => void
  toggleTaskPanel: () => void
  setTaskPanelOpen: (open: boolean) => void
  toggleBookingPanel: () => void
  setBookingPanelOpen: (open: boolean) => void
  setSettingsModalOpen: (open: boolean) => void
  toggleCommandBar: () => void
  setCommandBarOpen: (open: boolean) => void
  setTaskPanelMode: (mode: 'tasks' | 'routines') => void
  setTaskPanelViewMode: (mode: 'sidebar' | 'board') => void
  openPreviewPopover: (
    itemId: string,
    itemType: 'event' | 'task' | 'routine',
    position: { x: number; y: number }
  ) => void
  closePreviewPopover: () => void
  openEditForm: (
    itemId: string | null,
    itemType: 'event' | 'task' | 'routine',
    tab?: 'event' | 'task' | 'routine',
    initialData?: Record<string, unknown> | null,
    scope?: 'single' | 'future' | 'all' | 'custom' | null
  ) => void
  closeEditForm: () => void
  setEditFormTab: (tab: 'event' | 'task' | 'routine') => void
  openContextMenu: (
    itemId: string | null,
    itemType: 'event' | 'task' | 'routine' | null,
    position: { x: number; y: number }
  ) => void
  closeContextMenu: () => void
  setActiveSettingsPanel: (panel: UIState['activeSettingsPanel']) => void
}

const initialPreviewPopover: PreviewPopover = {
  isOpen: false,
  itemId: null,
  itemType: null,
  position: null,
}

const initialContextMenu = {
  isOpen: false,
  itemId: null as string | null,
  itemType: null as 'event' | 'task' | 'routine' | null,
  position: null as { x: number; y: number } | null,
}

/** Derive the mirror booleans from the authoritative activePanel. */
function panelState(panel: PanelId) {
  return {
    activePanel: panel,
    taskPanelOpen: panel === 'tasks',
    bookingPanelOpen: panel === 'booking',
  }
}

export const useUIStore = create<UIState>()((set) => ({
  // Panel states
  sidebarOpen: true,
  activePanel: 'calendar',
  taskPanelOpen: false,
  bookingPanelOpen: false,
  settingsModalOpen: false,
  commandBarOpen: false,

  // Task panel mode
  taskPanelMode: 'tasks',
  taskPanelViewMode: 'sidebar',

  // Preview popover
  previewPopover: { ...initialPreviewPopover },

  // Edit form
  editFormOpen: false,
  editFormItemId: null,
  editFormScope: null,
  editFormItemType: null,
  editFormTab: 'event',
  editFormInitialData: null,

  // Context menu
  contextMenu: { ...initialContextMenu },

  // Active settings panel
  activeSettingsPanel: 'general',

  // Actions
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setActivePanel: (panel) => set(panelState(panel)),

  toggleTaskPanel: () =>
    set((state) =>
      panelState(state.activePanel === 'tasks' ? 'calendar' : 'tasks')
    ),

  setTaskPanelOpen: (open) =>
    set((state) =>
      panelState(open ? 'tasks' : state.activePanel === 'tasks' ? 'calendar' : state.activePanel)
    ),

  toggleBookingPanel: () =>
    set((state) =>
      panelState(state.activePanel === 'booking' ? 'calendar' : 'booking')
    ),

  setBookingPanelOpen: (open) =>
    set((state) =>
      panelState(open ? 'booking' : state.activePanel === 'booking' ? 'calendar' : state.activePanel)
    ),

  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),

  toggleCommandBar: () =>
    set((state) => ({ commandBarOpen: !state.commandBarOpen })),

  setCommandBarOpen: (open) => set({ commandBarOpen: open }),

  setTaskPanelMode: (mode) => set({ taskPanelMode: mode }),

  setTaskPanelViewMode: (mode) => set({ taskPanelViewMode: mode }),

  openPreviewPopover: (itemId, itemType, position) =>
    set({
      previewPopover: { isOpen: true, itemId, itemType, position },
    }),

  closePreviewPopover: () =>
    set({ previewPopover: { ...initialPreviewPopover } }),

  openEditForm: (itemId, itemType, tab, initialData, scope) =>
    set({
      editFormOpen: true,
      editFormItemId: itemId,
      editFormScope: scope ?? null,
      editFormItemType: itemType,
      editFormTab: tab ?? itemType,
      editFormInitialData: initialData ?? null,
      previewPopover: { ...initialPreviewPopover },
    }),

  closeEditForm: () =>
    set({
      editFormOpen: false,
      editFormItemId: null,
      editFormScope: null,
      editFormItemType: null,
      editFormInitialData: null,
    }),

  setEditFormTab: (tab) => set({ editFormTab: tab }),

  openContextMenu: (itemId, itemType, position) =>
    set({
      contextMenu: { isOpen: true, itemId, itemType, position },
    }),

  closeContextMenu: () => set({ contextMenu: { ...initialContextMenu } }),

  setActiveSettingsPanel: (panel) => set({ activeSettingsPanel: panel }),
}))
