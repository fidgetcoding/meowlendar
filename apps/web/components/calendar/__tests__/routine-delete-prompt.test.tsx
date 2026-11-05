import * as React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Routine } from '@poolendar/types'
import '@/lib/hooks/__tests__/mock-supabase'

vi.stubGlobal('React', React)

const routine = {
  id: 'r1', user_id: 'u', calendar_id: null, title: 'Feed Miso', notes: null, start_time: '08:00', end_time: '08:15',
  timezone: 'UTC', recurrence_rule: 'FREQ=DAILY', location: null, visibility: 'busy', privacy: 'private',
  reminders: [], created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
} as Routine

const undoable = { deleteRoutine: vi.fn(), deleteRoutineOccurrences: vi.fn(), deleteEvent: vi.fn(), deleteTask: vi.fn() }
const deleteRoutineMutation = vi.fn()
vi.mock('@/lib/hooks/use-undoable', () => ({ useUndoable: () => undoable }))
vi.mock('@/lib/hooks/use-routines', () => ({
  useRoutines: () => ({ data: [routine] }),
  useCreateRoutine: () => ({ mutate: vi.fn() }),
  useDeleteRoutine: () => ({ mutate: deleteRoutineMutation }),
  useCompleteRoutineInstance: () => ({ mutate: vi.fn() }),
  useSkipRoutineInstance: () => ({ mutate: vi.fn() }),
  routineKeys: { lists: () => ['routines', 'list'] },
}))

import { useUIStore } from '@/lib/stores/ui-store'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { useCalendarContextActions } from '@/lib/hooks/use-calendar-context-actions'
import { useDeleteSelected } from '@/lib/hooks/use-delete-selected'
import { RoutineDeletePrompt } from '../RoutineDeletePrompt'

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient()
  client.setQueryData(['routines', 'list'], [routine])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// Right-click Delete and the Delete key used to delete the whole routine at once, with no scope
// choice and (from the menu) no undo. Both now ask for the scope like the preview does.
describe('every way to delete a routine occurrence asks for the scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState(useUIStore.getInitialState(), true)
    useCalendarStore.setState({ selectedItemId: null, selectedItemType: null, selectedOccurrenceDate: null })
  })
  afterEach(cleanup)

  it('right-click Delete opens the scope prompt for that day and deletes nothing yet', () => {
    useUIStore.getState().openContextMenu('r1-2026-11-05', 'routine', { x: 0, y: 0 })
    const { result } = renderHook(
      () => useCalendarContextActions({ events: [], tasks: [], routines: [routine], calendars: [], userId: 'u', currentDate: new Date(2026, 10, 5) }),
      { wrapper },
    )
    act(() => result.current.onDelete())
    expect(deleteRoutineMutation).not.toHaveBeenCalled()
    expect(useUIStore.getState().routineDeletePrompt).toEqual({ routineId: 'r1', date: '2026-11-05' })
  })

  it('the Delete key on a selected occurrence opens the same prompt', () => {
    useCalendarStore.getState().selectItem('r1', 'routine', '2026-11-05')
    const { result } = renderHook(() => useDeleteSelected(), { wrapper })
    act(() => result.current())
    expect(undoable.deleteRoutine).not.toHaveBeenCalled()
    expect(useUIStore.getState().routineDeletePrompt).toEqual({ routineId: 'r1', date: '2026-11-05' })
  })

  it('the prompt deletes with the chosen scope through the undoable path, then closes', () => {
    useUIStore.getState().openRoutineDeletePrompt({ routineId: 'r1', date: '2026-11-05' })
    render(<RoutineDeletePrompt />, { wrapper })
    const dialog = screen.getByRole('dialog', { name: /delete recurring item/i })
    fireEvent.click(within(dialog).getByLabelText(/^Only this occurrence/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(undoable.deleteRoutineOccurrences).toHaveBeenCalledWith(routine, '2026-11-05', { type: 'single' })
    expect(useUIStore.getState().routineDeletePrompt).toBeNull()
  })

  it('closing the prompt deletes nothing', () => {
    useUIStore.getState().openRoutineDeletePrompt({ routineId: 'r1', date: '2026-11-05' })
    render(<RoutineDeletePrompt />, { wrapper })
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete recurring item/i })).getByRole('button', { name: /cancel/i }))
    expect(undoable.deleteRoutineOccurrences).not.toHaveBeenCalled()
    expect(useUIStore.getState().routineDeletePrompt).toBeNull()
  })

  it('events and tasks still delete straight away from the Delete key', () => {
    const client = new QueryClient()
    client.setQueryData(['tasks', 'list', {}], [{ id: 't1', title: 'A' }])
    useCalendarStore.getState().selectItem('t1', 'task')
    const { result } = renderHook(() => useDeleteSelected(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })
    act(() => result.current())
    expect(undoable.deleteTask).toHaveBeenCalledWith({ id: 't1', title: 'A' })
    expect(useUIStore.getState().routineDeletePrompt).toBeNull()
  })
})
