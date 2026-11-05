'use client'

import { useIsMutating } from '@tanstack/react-query'
import { Undo2, Redo2 } from 'lucide-react'
import { useUndoContext } from '@/lib/undo/undo-context'

/** Undo / Redo under the header, with the save state on the right (shared undo engine, #72d). */
export function UndoStrip() {
  const { undo, redo, canUndo, canRedo } = useUndoContext()
  const saving = useIsMutating() > 0
  return (
    <div className="meow-strip">
      <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
        <Undo2 size={15} strokeWidth={1.6} />
        <span aria-hidden="true">Undo</span>
      </button>
      <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={15} strokeWidth={1.6} />
        <span aria-hidden="true">Redo</span>
      </button>
      <span className="meow-strip-sv" role="status">
        {saving ? 'Saving...' : 'All changes saved'}
      </span>
    </div>
  )
}
