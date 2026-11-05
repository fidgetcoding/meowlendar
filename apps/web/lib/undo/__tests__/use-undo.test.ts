import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUndo } from '@/lib/hooks/use-undo'

function makeOp(overrides: Partial<Parameters<ReturnType<typeof useUndo>['pushOperation']>[0]> = {}) {
  return {
    type: 'delete' as const,
    entityType: 'task' as const,
    entityId: 'task-1',
    previousState: { id: 'task-1' },
    newState: null,
    execute: vi.fn().mockResolvedValue(undefined),
    commitOnUnload: vi.fn(),
    rollback: vi.fn(),
    ...overrides,
  }
}

describe('useUndo — destructive grace window', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('defers execute during the grace window', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp()

    act(() => result.current.pushOperation(op))

    // Not executed yet, but pending + undoable.
    expect(op.execute).not.toHaveBeenCalled()
    expect(result.current.pendingOperations).toHaveLength(1)
    expect(result.current.canUndo).toBe(true)
  })

  it('cancelPending rolls back and never executes', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp()

    act(() => result.current.pushOperation(op))
    const id = result.current.pendingOperations[0]!.id
    act(() => result.current.cancelPending(id))

    expect(op.rollback).toHaveBeenCalledTimes(1)
    expect(op.execute).not.toHaveBeenCalled()
    expect(result.current.pendingOperations).toHaveLength(0)
  })

  it('commits execute once the grace window elapses', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp()

    act(() => result.current.pushOperation(op))
    act(() => vi.advanceTimersByTime(30_000))

    expect(op.execute).toHaveBeenCalledTimes(1)
    expect(op.rollback).not.toHaveBeenCalled()
    expect(result.current.pendingOperations).toHaveLength(0)
  })

  it('flushPending commits every pending op immediately', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const a = makeOp({ entityId: 'a' })
    const b = makeOp({ entityId: 'b' })

    act(() => {
      result.current.pushOperation(a)
      result.current.pushOperation(b)
    })
    act(() => result.current.flushPending())

    expect(a.execute).toHaveBeenCalledTimes(1)
    expect(b.execute).toHaveBeenCalledTimes(1)
    expect(result.current.pendingOperations).toHaveLength(0)
  })
})

describe('useUndo — non-destructive ops', () => {
  it('executes create/update immediately (no grace)', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp({ type: 'update' })

    act(() => result.current.pushOperation(op))

    expect(op.execute).toHaveBeenCalledTimes(1)
    expect(result.current.pendingOperations).toHaveLength(0)
    expect(result.current.canUndo).toBe(true)
  })

  it('undo pops the stack and rolls back; redo re-executes', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp({ type: 'update' })

    act(() => result.current.pushOperation(op))
    act(() => result.current.undo())
    expect(op.rollback).toHaveBeenCalledTimes(1)
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.redo())
    expect(op.execute).toHaveBeenCalledTimes(2)
  })
})

describe('useUndo — redo after undoing inside the grace window', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('undoing a pending delete makes it redoable, and redo deletes for real', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp()

    act(() => result.current.pushOperation(op))
    act(() => result.current.undo())

    expect(op.rollback).toHaveBeenCalledTimes(1)
    expect(op.execute).not.toHaveBeenCalled()
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.redo())
    expect(op.execute).toHaveBeenCalledTimes(1)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.canUndo).toBe(true)
  })

  it("the toast's Undo (cancelPending) is redoable too", () => {
    const { result } = renderHook(() => useUndo(30_000))
    act(() => result.current.pushOperation(makeOp()))
    act(() => result.current.cancelPending(result.current.pendingOperations[0]!.id))
    expect(result.current.canRedo).toBe(true)
  })
})

describe('useUndo — leaving the page', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('commits pending operations through their unload path when the page is hidden (pagehide)', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp()
    act(() => result.current.pushOperation(op))

    act(() => { window.dispatchEvent(new Event('pagehide')) })

    // The unload path, not execute: execute's requests would be aborted with the page.
    expect(op.commitOnUnload).toHaveBeenCalledTimes(1)
    expect(op.execute).not.toHaveBeenCalled()
    expect(result.current.pendingOperations).toHaveLength(0)
    // Nothing runs again when the grace timer would have fired.
    act(() => vi.advanceTimersByTime(30_000))
    expect(op.execute).not.toHaveBeenCalled()
    expect(op.commitOnUnload).toHaveBeenCalledTimes(1)
  })

  it('runs a destructive op at once when it has no way to commit on unload', () => {
    const { result } = renderHook(() => useUndo(30_000))
    const op = makeOp({ commitOnUnload: undefined })
    act(() => result.current.pushOperation(op))
    expect(op.execute).toHaveBeenCalledTimes(1)
    expect(result.current.pendingOperations).toHaveLength(0)
  })
})

describe('useUndo — a create still in flight when the page goes', () => {
  it('resends it through its unload path on pagehide, until its write comes back', async () => {
    const { result } = renderHook(() => useUndo(30_000))
    let finish!: () => void
    const op = makeOp({ type: 'create', execute: vi.fn(() => new Promise<void>((r) => { finish = r })) })
    act(() => result.current.pushOperation(op))
    expect(op.execute).toHaveBeenCalledTimes(1)

    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(op.commitOnUnload).toHaveBeenCalledTimes(1)

    // Once the write has come back there's nothing left to resend.
    const second = makeOp({ type: 'create' })
    act(() => result.current.pushOperation(second))
    await act(async () => { finish() })
    await act(async () => {})
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(second.commitOnUnload).not.toHaveBeenCalled()
  })
})
