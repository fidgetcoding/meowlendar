'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'

/**
 * A failed mutation used to be swallowed by a bare `.catch(rollback)`: the
 * optimistic UI reverted with no log and no message, so a create that never
 * landed looked identical to one that did. Surface it instead.
 */
function reportOperationFailure(op: { type: string; entityType: string }, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err)
  console.error(`[undo] ${op.type} ${op.entityType} failed:`, err)
  toast.error(`Could not ${op.type} that ${op.entityType}.`, { description: detail })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UndoOperation {
  id: string
  type: 'create' | 'update' | 'delete' | 'move' | 'complete'
  entityType: 'event' | 'task' | 'routine' | 'subtask'
  entityId: string
  previousState: Record<string, unknown> | null
  newState: Record<string, unknown> | null
  timestamp: number
  /** The actual mutation function to execute after grace period */
  execute: () => Promise<void>
  /** The rollback function to undo optimistic state */
  rollback: () => void
}

type OperationInput = Omit<UndoOperation, 'id' | 'timestamp'>

interface PendingEntry {
  operation: UndoOperation
  timeoutId: ReturnType<typeof setTimeout>
}

export interface PendingOperationInfo {
  id: string
  type: string
  entityType: string
  expiresAt: number
}

const MAX_STACK_DEPTH = 50

/** Operation types that get a grace-period delay before executing */
const DESTRUCTIVE_TYPES = new Set<UndoOperation['type']>([
  'delete',
  'complete',
  'move',
])

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUndo(gracePeriodMs = 30_000) {
  const undoStackRef = useRef<UndoOperation[]>([])
  const redoStackRef = useRef<UndoOperation[]>([])
  const pendingRef = useRef<Map<string, PendingEntry>>(new Map())

  // Reactive state for consumers
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [pendingOperations, setPendingOperations] = useState<PendingOperationInfo[]>([])

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  const syncState = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0 || pendingRef.current.size > 0)
    setCanRedo(redoStackRef.current.length > 0)
    setPendingOperations(
      Array.from(pendingRef.current.values()).map(({ operation }) => ({
        id: operation.id,
        type: operation.type,
        entityType: operation.entityType,
        expiresAt: operation.timestamp + gracePeriodMs,
      })),
    )
  }, [gracePeriodMs])

  const pushToStack = useCallback(
    (stack: UndoOperation[], op: UndoOperation) => {
      stack.push(op)
      if (stack.length > MAX_STACK_DEPTH) {
        stack.shift()
      }
    },
    [],
  )

  // -----------------------------------------------------------------------
  // Push operation
  // -----------------------------------------------------------------------

  const pushOperation = useCallback(
    (input: OperationInput) => {
      const op: UndoOperation = {
        ...input,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      }

      // Clear redo stack on any new operation
      redoStackRef.current = []

      if (DESTRUCTIVE_TYPES.has(op.type)) {
        // Grace period: delay execution, allow cancel
        const timeoutId = setTimeout(() => {
          pendingRef.current.delete(op.id)
          op.execute().catch((err) => {
            // Execution failed — roll back the optimistic UI
            reportOperationFailure(op, err)
            op.rollback()
          })
          // Move to undo stack after execution
          pushToStack(undoStackRef.current, op)
          syncState()
        }, gracePeriodMs)

        pendingRef.current.set(op.id, { operation: op, timeoutId })
      } else {
        // Non-destructive: execute immediately
        op.execute().catch((err) => {
          reportOperationFailure(op, err)
          op.rollback()
        })
        pushToStack(undoStackRef.current, op)
      }

      syncState()
    },
    [gracePeriodMs, pushToStack, syncState],
  )

  // -----------------------------------------------------------------------
  // Cancel a specific pending operation
  // -----------------------------------------------------------------------

  const cancelPending = useCallback(
    (operationId: string) => {
      const entry = pendingRef.current.get(operationId)
      if (!entry) return

      clearTimeout(entry.timeoutId)
      entry.operation.rollback()
      pendingRef.current.delete(operationId)
      syncState()
    },
    [syncState],
  )

  // -----------------------------------------------------------------------
  // Undo
  // -----------------------------------------------------------------------

  const undo = useCallback(() => {
    // First check if the most recent action is still pending (grace period)
    // Find the most recent pending operation by timestamp
    let latestPending: PendingEntry | null = null
    for (const entry of pendingRef.current.values()) {
      if (!latestPending || entry.operation.timestamp > latestPending.operation.timestamp) {
        latestPending = entry
      }
    }

    if (latestPending) {
      // Cancel the most recent pending operation
      cancelPending(latestPending.operation.id)
      return
    }

    // Otherwise pop from undo stack
    const op = undoStackRef.current.pop()
    if (!op) return

    op.rollback()
    pushToStack(redoStackRef.current, op)
    syncState()
  }, [cancelPending, pushToStack, syncState])

  // -----------------------------------------------------------------------
  // Redo
  // -----------------------------------------------------------------------

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop()
    if (!op) return

    op.execute().catch(() => {
      op.rollback()
    })
    pushToStack(undoStackRef.current, op)
    syncState()
  }, [pushToStack, syncState])

  // -----------------------------------------------------------------------
  // Flush all pending
  // -----------------------------------------------------------------------

  const flushPending = useCallback(() => {
    for (const [id, entry] of pendingRef.current) {
      clearTimeout(entry.timeoutId)
      entry.operation.execute().catch(() => {
        entry.operation.rollback()
      })
      pushToStack(undoStackRef.current, entry.operation)
      pendingRef.current.delete(id)
    }
    syncState()
  }, [pushToStack, syncState])

  // -----------------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------------

  useEffect(() => {
    // The Map is created once and only mutated in place, so this reference still
    // holds every pending operation when the cleanup runs.
    const pending = pendingRef.current
    return () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timeoutId)
        // Flush pending operations on unmount so they don't get lost
        entry.operation.execute().catch(() => {})
      }
      pending.clear()
    }
  }, [])

  return {
    pushOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    pendingOperations,
    cancelPending,
    flushPending,
  }
}
