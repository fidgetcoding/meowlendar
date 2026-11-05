import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../ui-store'

// ---------------------------------------------------------------------------
// Reset store between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('UIStore - Initial state', () => {
  it('sidebar is open by default', () => {
    expect(useUIStore.getState().sidebarOpen).toBe(true)
  })

  it('task panel is open', () => {
    expect(useUIStore.getState().activePanel).toBe('tasks')
    expect(useUIStore.getState().taskPanelOpen).toBe(true)
  })

  it('booking panel is closed', () => {
    expect(useUIStore.getState().bookingPanelOpen).toBe(false)
  })

  it('settings modal is closed', () => {
    expect(useUIStore.getState().settingsModalOpen).toBe(false)
  })

  it('command bar is closed', () => {
    expect(useUIStore.getState().commandBarOpen).toBe(false)
  })

  it('edit form is closed', () => {
    expect(useUIStore.getState().editFormOpen).toBe(false)
    expect(useUIStore.getState().editFormItemId).toBeNull()
    expect(useUIStore.getState().editFormItemType).toBeNull()
  })

  it('preview popover is closed', () => {
    expect(useUIStore.getState().previewPopover.isOpen).toBe(false)
  })

  it('context menu is closed', () => {
    expect(useUIStore.getState().contextMenu.isOpen).toBe(false)
  })

  it('task panel mode defaults to tasks', () => {
    expect(useUIStore.getState().taskPanelMode).toBe('tasks')
  })

  it('task panel view mode defaults to sidebar', () => {
    expect(useUIStore.getState().taskPanelViewMode).toBe('sidebar')
  })

  it('active settings panel defaults to general', () => {
    expect(useUIStore.getState().activeSettingsPanel).toBe('general')
  })
})

// ---------------------------------------------------------------------------
// Task panel
// ---------------------------------------------------------------------------

describe('UIStore - toggleTaskPanel', () => {
  it('opens task panel when closed', () => {
    useUIStore.getState().setTaskPanelOpen(false)
    useUIStore.getState().toggleTaskPanel()
    expect(useUIStore.getState().taskPanelOpen).toBe(true)
  })

  it('closes task panel when open', () => {
    useUIStore.getState().setTaskPanelOpen(false)
    useUIStore.getState().toggleTaskPanel()
    useUIStore.getState().toggleTaskPanel()
    expect(useUIStore.getState().taskPanelOpen).toBe(false)
  })

  it('setTaskPanelOpen forces open', () => {
    useUIStore.getState().setTaskPanelOpen(true)
    expect(useUIStore.getState().taskPanelOpen).toBe(true)
  })

  it('setTaskPanelOpen forces closed', () => {
    useUIStore.getState().setTaskPanelOpen(true)
    useUIStore.getState().setTaskPanelOpen(false)
    expect(useUIStore.getState().taskPanelOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Booking panel
// ---------------------------------------------------------------------------

describe('UIStore - toggleBookingPanel', () => {
  it('opens booking panel when closed', () => {
    useUIStore.getState().toggleBookingPanel()
    expect(useUIStore.getState().bookingPanelOpen).toBe(true)
  })

  it('closes booking panel when open', () => {
    useUIStore.getState().toggleBookingPanel()
    useUIStore.getState().toggleBookingPanel()
    expect(useUIStore.getState().bookingPanelOpen).toBe(false)
  })

  it('setBookingPanelOpen forces open', () => {
    useUIStore.getState().setBookingPanelOpen(true)
    expect(useUIStore.getState().bookingPanelOpen).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

describe('UIStore - sidebar', () => {
  it('toggleSidebar closes the sidebar', () => {
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarOpen).toBe(false)
  })

  it('toggleSidebar reopens the sidebar', () => {
    useUIStore.getState().toggleSidebar()
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarOpen).toBe(true)
  })

  it('setSidebarOpen sets explicitly', () => {
    useUIStore.getState().setSidebarOpen(false)
    expect(useUIStore.getState().sidebarOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

describe('UIStore - settings modal', () => {
  it('opens settings modal', () => {
    useUIStore.getState().setSettingsModalOpen(true)
    expect(useUIStore.getState().settingsModalOpen).toBe(true)
  })

  it('closes settings modal', () => {
    useUIStore.getState().setSettingsModalOpen(true)
    useUIStore.getState().setSettingsModalOpen(false)
    expect(useUIStore.getState().settingsModalOpen).toBe(false)
  })

  it('setActiveSettingsPanel changes panel', () => {
    useUIStore.getState().setActiveSettingsPanel('calendars')
    expect(useUIStore.getState().activeSettingsPanel).toBe('calendars')
  })
})

// ---------------------------------------------------------------------------
// Command bar
// ---------------------------------------------------------------------------

describe('UIStore - command bar', () => {
  it('toggleCommandBar opens', () => {
    useUIStore.getState().toggleCommandBar()
    expect(useUIStore.getState().commandBarOpen).toBe(true)
  })

  it('toggleCommandBar closes', () => {
    useUIStore.getState().toggleCommandBar()
    useUIStore.getState().toggleCommandBar()
    expect(useUIStore.getState().commandBarOpen).toBe(false)
  })

  it('setCommandBarOpen forces state', () => {
    useUIStore.getState().setCommandBarOpen(true)
    expect(useUIStore.getState().commandBarOpen).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Task panel mode
// ---------------------------------------------------------------------------

describe('UIStore - task panel mode', () => {
  it('switches to routines', () => {
    useUIStore.getState().setTaskPanelMode('routines')
    expect(useUIStore.getState().taskPanelMode).toBe('routines')
  })

  it('switches view mode to board', () => {
    useUIStore.getState().setTaskPanelViewMode('board')
    expect(useUIStore.getState().taskPanelViewMode).toBe('board')
  })
})

// ---------------------------------------------------------------------------
// Preview popover
// ---------------------------------------------------------------------------

describe('UIStore - preview popover', () => {
  it('opens with item details and position', () => {
    useUIStore.getState().openPreviewPopover('evt-1', 'event', { x: 100, y: 200 })
    const { previewPopover } = useUIStore.getState()
    expect(previewPopover.isOpen).toBe(true)
    expect(previewPopover.itemId).toBe('evt-1')
    expect(previewPopover.itemType).toBe('event')
    expect(previewPopover.position).toEqual({ x: 100, y: 200 })
  })

  it('closes and resets all fields', () => {
    useUIStore.getState().openPreviewPopover('evt-1', 'event', { x: 100, y: 200 })
    useUIStore.getState().closePreviewPopover()
    const { previewPopover } = useUIStore.getState()
    expect(previewPopover.isOpen).toBe(false)
    expect(previewPopover.itemId).toBeNull()
    expect(previewPopover.itemType).toBeNull()
    expect(previewPopover.position).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

describe('UIStore - edit form', () => {
  it('opens with item details', () => {
    useUIStore.getState().openEditForm('task-1', 'task')
    const state = useUIStore.getState()
    expect(state.editFormOpen).toBe(true)
    expect(state.editFormItemId).toBe('task-1')
    expect(state.editFormItemType).toBe('task')
    expect(state.editFormTab).toBe('task')
  })

  it('defaults tab to itemType when no tab specified', () => {
    useUIStore.getState().openEditForm('r-1', 'routine')
    expect(useUIStore.getState().editFormTab).toBe('routine')
  })

  it('uses explicit tab override', () => {
    useUIStore.getState().openEditForm('task-1', 'task', 'event')
    expect(useUIStore.getState().editFormTab).toBe('event')
  })

  it('closes preview popover when edit form opens', () => {
    useUIStore.getState().openPreviewPopover('evt-1', 'event', { x: 0, y: 0 })
    useUIStore.getState().openEditForm('evt-1', 'event')
    expect(useUIStore.getState().previewPopover.isOpen).toBe(false)
  })

  it('closes and resets fields', () => {
    useUIStore.getState().openEditForm('task-1', 'task')
    useUIStore.getState().closeEditForm()
    const state = useUIStore.getState()
    expect(state.editFormOpen).toBe(false)
    expect(state.editFormItemId).toBeNull()
    expect(state.editFormItemType).toBeNull()
  })

  it('allows creating new items with null id', () => {
    useUIStore.getState().openEditForm(null, 'event')
    const state = useUIStore.getState()
    expect(state.editFormOpen).toBe(true)
    expect(state.editFormItemId).toBeNull()
    expect(state.editFormItemType).toBe('event')
  })

  it('setEditFormTab switches tab independently', () => {
    useUIStore.getState().openEditForm('x', 'event')
    useUIStore.getState().setEditFormTab('routine')
    expect(useUIStore.getState().editFormTab).toBe('routine')
  })
})

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

describe('UIStore - context menu', () => {
  it('opens with details and position', () => {
    useUIStore.getState().openContextMenu('evt-1', 'event', { x: 300, y: 400 })
    const { contextMenu } = useUIStore.getState()
    expect(contextMenu.isOpen).toBe(true)
    expect(contextMenu.itemId).toBe('evt-1')
    expect(contextMenu.itemType).toBe('event')
    expect(contextMenu.position).toEqual({ x: 300, y: 400 })
  })

  it('closes and resets all fields', () => {
    useUIStore.getState().openContextMenu('evt-1', 'event', { x: 300, y: 400 })
    useUIStore.getState().closeContextMenu()
    const { contextMenu } = useUIStore.getState()
    expect(contextMenu.isOpen).toBe(false)
    expect(contextMenu.itemId).toBeNull()
    expect(contextMenu.itemType).toBeNull()
    expect(contextMenu.position).toBeNull()
  })
})
