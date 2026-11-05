import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { mockSupabaseClient, resetSupabaseMocks } from './mock-supabase'
import { UndoContext, type UndoApi } from '@/lib/undo/undo-context'
import type { UndoOperation } from '../use-undo'
import { useUndoable } from '../use-undoable'
import type { Routine } from '@poolendar/types'

const routine = {
  id: 'r1', user_id: 'u1', calendar_id: null, title: 'Feed Miso', notes: null, start_time: '08:00', end_time: '08:15',
  timezone: 'America/New_York', recurrence_rule: 'FREQ=DAILY', location: null, visibility: 'busy', privacy: 'private',
  reminders: [], created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
} as Routine

function setup() {
  const pushOperation = vi.fn()
  const engine = { pushOperation } as unknown as UndoApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, createElement(UndoContext.Provider, { value: engine }, children))
  const { result } = renderHook(() => useUndoable(), { wrapper })
  const lastOp = () => pushOperation.mock.calls.at(-1)![0] as UndoOperation
  return { result, pushOperation, lastOp }
}

const tablesTouched = () => mockSupabaseClient.from.mock.calls.map(([table]) => table)

describe('deleting part of a routine', () => {
  beforeEach(() => resetSupabaseMocks())

  it('"only this occurrence" skips that date, and undo puts it back', async () => {
    const { result, lastOp } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, '2026-11-05', { type: 'single' }))
    const op = lastOp()
    expect(op).toMatchObject({ type: 'update', entityType: 'routine', entityId: 'r1', newState: { dates: ['2026-11-05'], status: 'skipped' } })

    await act(() => op.execute())
    expect(tablesTouched()).toEqual(['routine_instances'])
    expect(tablesTouched()).not.toContain('routines')

    mockSupabaseClient.from.mockClear()
    act(() => op.rollback())
    // Undo writes the instance back (to pending, its state before the skip).
    await waitFor(() => expect(tablesTouched()).toEqual(['routine_instances']))
  })

  it('undo of a skipped occurrence that had been done marks it done again', () => {
    const { result, lastOp } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, '2026-11-05', { type: 'single' }, 'completed'))
    expect(lastOp().previousState).toMatchObject({ dates: ['2026-11-05'], status: 'completed' })
  })

  it('custom dates skip each of them', () => {
    const { result, lastOp } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, '2026-11-05', { type: 'custom', dates: ['2026-11-06', '2026-11-08'] }))
    expect(lastOp().newState).toMatchObject({ dates: ['2026-11-06', '2026-11-08'], status: 'skipped' })
  })

  it('"this and all future" ends the rule the day before, and undo restores the rule', () => {
    const { result, lastOp } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, '2026-11-05', { type: 'future' }))
    const op = lastOp()
    expect(op).toMatchObject({ type: 'update', entityType: 'routine', newState: { recurrence_rule: 'FREQ=DAILY;UNTIL=20261104T235959Z' } })
    expect(op.previousState).toMatchObject({ recurrence_rule: 'FREQ=DAILY' })
  })

  it('"this and all future" from the first day deletes the whole routine', () => {
    const { result, lastOp } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, '2026-10-01', { type: 'future' }))
    expect(lastOp()).toMatchObject({ type: 'delete', entityType: 'routine', entityId: 'r1' })
  })

  it('"all occurrences" deletes the routine', () => {
    const { result, lastOp } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, '2026-11-05', { type: 'all' }))
    expect(lastOp()).toMatchObject({ type: 'delete', entityType: 'routine', entityId: 'r1' })
  })

  it('without a date, a single-occurrence scope changes nothing rather than deleting everything', () => {
    const { result, pushOperation } = setup()
    act(() => result.current.deleteRoutineOccurrences(routine, null, { type: 'single' }))
    expect(pushOperation).not.toHaveBeenCalled()
  })
})
