'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type RecurrenceEditScope =
  | { type: 'single' }
  | { type: 'future' }
  | { type: 'all' }
  | { type: 'custom'; dates: string[] }

interface RecurrenceEditDialogProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (scope: RecurrenceEditScope) => void
  itemTitle: string
  mode: 'edit' | 'delete'
  occurrenceDates?: string[]
}

type ScopeOption = 'single' | 'future' | 'all' | 'custom'

export function RecurrenceEditDialog({
  isOpen,
  onClose,
  onSelect,
  itemTitle,
  mode,
  occurrenceDates = [],
}: RecurrenceEditDialogProps) {
  const [isMounted, setIsMounted] = React.useState(false)
  const [selected, setSelected] = React.useState<ScopeOption>('single')
  const [customDates, setCustomDates] = React.useState<string[]>([])
  const dialogRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])

  // Reset state when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setSelected('single')
      setCustomDates([])
    }
  }, [isOpen])

  // Close on Escape
  React.useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  function toggleCustomDate(date: string) {
    setCustomDates((prev) =>
      prev.includes(date)
        ? prev.filter((d) => d !== date)
        : [...prev, date]
    )
  }

  function handleApply() {
    switch (selected) {
      case 'single':
        onSelect({ type: 'single' })
        break
      case 'future':
        onSelect({ type: 'future' })
        break
      case 'all':
        onSelect({ type: 'all' })
        break
      case 'custom':
        onSelect({ type: 'custom', dates: customDates })
        break
    }
  }

  if (!isMounted || !isOpen) return null

  const isDelete = mode === 'delete'
  const actionLabel = isDelete ? 'Delete' : 'Apply'
  const headingLabel = isDelete ? 'Delete recurring item' : 'Edit recurring item'

  const options: { value: ScopeOption; label: string; description: string }[] = [
    {
      value: 'single',
      label: 'Only this occurrence',
      description: isDelete
        ? 'Remove only this date from the series'
        : 'Change only this date, leaving other occurrences unchanged',
    },
    {
      value: 'future',
      label: 'This and all future',
      description: isDelete
        ? 'Remove this and all future occurrences'
        : 'Change this and all future occurrences',
    },
    {
      value: 'all',
      label: 'All occurrences',
      description: isDelete
        ? 'Remove the entire recurring series'
        : 'Change every occurrence in the series',
    },
    {
      value: 'custom',
      label: 'Custom',
      description: 'Select specific dates to apply changes to',
    },
  ]

  const applyDisabled = selected === 'custom' && customDates.length === 0

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-label={headingLabel}
        className={cn(
          'relative w-full max-w-[420px] mx-4',
          'bg-[var(--surface)] border border-[var(--border)]',
          'rounded-xl shadow-2xl shadow-black/60',
          'animate-in fade-in-0 zoom-in-95 duration-150'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {isDelete && (
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
            )}
            <h2 className="text-base font-semibold text-[var(--fg)]">
              {headingLabel}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded-md',
              'text-[var(--muted)] hover:text-[var(--fg)]',
              'hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <X size={16} />
          </button>
        </div>

        {/* Item title */}
        <div className="px-5 pb-4">
          <p className="text-sm text-[var(--muted)] truncate">
            {itemTitle}
          </p>
        </div>

        {/* Scope options */}
        <div className="px-5 pb-4 space-y-1.5">
          {options.map((opt) => (
            <div key={opt.value}>
              <label
                className={cn(
                  'flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
                  'border transition-colors duration-150',
                  selected === opt.value
                    ? 'border-amber-500/50 bg-amber-500/5'
                    : 'border-transparent hover:bg-[var(--surface-hover)]'
                )}
              >
                <input
                  type="radio"
                  name="recurrence-scope"
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                  className="mt-0.5 accent-amber-500"
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-[var(--fg)]">
                    {opt.label}
                  </span>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {opt.description}
                  </p>
                </div>
              </label>

              {/* Custom date checkboxes */}
              {opt.value === 'custom' && selected === 'custom' && (
                <div className="ml-9 mt-2 mb-1 space-y-1 max-h-[160px] overflow-y-auto">
                  {occurrenceDates.length > 0 ? (
                    occurrenceDates.map((dateStr) => {
                      const checked = customDates.includes(dateStr)
                      let displayDate: string
                      try {
                        displayDate = format(parseISO(dateStr), 'EEE, MMM d, yyyy')
                      } catch {
                        displayDate = dateStr
                      }
                      return (
                        <label
                          key={dateStr}
                          className={cn(
                            'flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer',
                            'transition-colors duration-150',
                            checked
                              ? 'bg-[var(--surface-hover)]'
                              : 'hover:bg-[var(--surface-hover)]'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCustomDate(dateStr)}
                            className="accent-amber-500"
                          />
                          <span className="text-xs text-[var(--fg)]">
                            {displayDate}
                          </span>
                        </label>
                      )
                    })
                  ) : (
                    <p className="text-xs text-[var(--muted)] italic px-2.5 py-1.5">
                      No upcoming occurrence dates available
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium',
              'text-[var(--muted)] hover:text-[var(--fg)]',
              'hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={applyDisabled}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium',
              'transition-colors duration-150',
              'disabled:opacity-40 disabled:pointer-events-none',
              isDelete
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-amber-500 text-zinc-900 hover:bg-amber-400'
            )}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
