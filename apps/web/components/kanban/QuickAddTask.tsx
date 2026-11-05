'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import type { TaskStatus, TaskImportance } from '@poolendar/types'

const IMPORTANCE_OPTIONS: { value: TaskImportance; label: string }[] = [
  { value: 'highest', label: 'Highest' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
  { value: 'lowest', label: 'Lowest' },
]

interface QuickAddTaskProps {
  status: TaskStatus
  onCreateTask: (data: {
    title: string
    status: TaskStatus
    importance: TaskImportance
    due_date: string | null
  }) => void
  /** Render already open (used by the column-header "+" entry point, #42). */
  startOpen?: boolean
  /** Called when the form closes — lets a controlled parent hide it. */
  onClose?: () => void
}

export function QuickAddTask({ status, onCreateTask, startOpen = false, onClose }: QuickAddTaskProps) {
  const [isOpen, setIsOpen] = useState(startOpen)
  const [title, setTitle] = useState('')
  const [importance, setImportance] = useState<TaskImportance>('normal')
  const [dueDate, setDueDate] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    onCreateTask({
      title: title.trim(),
      status,
      importance,
      due_date: dueDate || null,
    })

    setTitle('')
    setImportance('normal')
    setDueDate('')
    setIsOpen(false)
    onClose?.()
  }

  function handleCancel() {
    setTitle('')
    setImportance('normal')
    setDueDate('')
    setIsOpen(false)
    onClose?.()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-sm rounded-md transition-colors duration-150"
        style={{ color: 'var(--muted)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
          e.currentTarget.style.color = 'var(--fg)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--muted)'
        }}
      >
        <Plus size={14} />
        Add task
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="p-3 rounded-lg border"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title..."
        className="w-full text-sm px-2 py-1.5 rounded-md border outline-none transition-colors duration-150"
        style={{
          backgroundColor: 'var(--bg)',
          borderColor: 'var(--border)',
          color: 'var(--fg)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      />

      <div className="flex gap-2 mt-2">
        <select
          value={importance}
          onChange={(e) => setImportance(e.target.value as TaskImportance)}
          className="text-xs px-2 py-1 rounded-md border outline-none"
          style={{
            backgroundColor: 'var(--bg)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
          }}
        >
          {IMPORTANCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="text-xs px-2 py-1 rounded-md border outline-none flex-1"
          style={{
            backgroundColor: 'var(--bg)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
            colorScheme: 'dark',
          }}
        />
      </div>

      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={handleCancel}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors duration-150"
          style={{ color: 'var(--muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <X size={12} />
          Cancel
        </button>

        <button
          type="submit"
          disabled={!title.trim()}
          className="text-xs px-3 py-1 rounded-md font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--bg)',
          }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.backgroundColor = 'var(--accent-hover)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--accent)'
          }}
        >
          Create
        </button>
      </div>
    </form>
  )
}
