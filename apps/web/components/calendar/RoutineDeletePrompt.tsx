'use client'

import { useRoutines } from '@/lib/hooks/use-routines'
import { useUndoable } from '@/lib/hooks/use-undoable'
import { useUIStore } from '@/lib/stores/ui-store'
import { RecurrenceEditDialog } from './RecurrenceEditDialog'

/**
 * The delete-scope prompt for a routine occurrence opened from outside the preview (right-click
 * Delete, the Delete key). Same dialog and same undoable delete as the preview and the edit form.
 */
export function RoutineDeletePrompt() {
  const prompt = useUIStore((s) => s.routineDeletePrompt)
  const close = useUIStore((s) => s.closeRoutineDeletePrompt)
  const { data: routines = [] } = useRoutines()
  const undoable = useUndoable()
  const routine = prompt ? routines.find((r) => r.id === prompt.routineId) : undefined

  return (
    <RecurrenceEditDialog
      // A fresh dialog per occurrence, so the last choice never carries over.
      key={prompt ? `${prompt.routineId}-${prompt.date ?? ''}` : 'closed'}
      isOpen={Boolean(prompt && routine)}
      mode="delete"
      itemTitle={routine?.title ?? ''}
      onClose={close}
      onSelect={(scope) => {
        if (prompt && routine) undoable.deleteRoutineOccurrences(routine, prompt.date, scope)
        close()
      }}
    />
  )
}
