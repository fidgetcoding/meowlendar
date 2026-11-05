'use client'

import * as React from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover } from './Popover'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  options: SelectOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}

function Select({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
}: SelectProps) {
  const [open, setOpen] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  const listboxId = React.useId()

  const selectedOption = options.find((opt) => opt.value === value)
  const enabledOptions = options.filter((opt) => !opt.disabled)

  function openDropdown() {
    if (disabled) return
    setOpen(true)
    const selectedIdx = enabledOptions.findIndex((opt) => opt.value === value)
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0)
  }

  function closeDropdown() {
    setOpen(false)
    setHighlightedIndex(-1)
    triggerRef.current?.focus()
  }

  function selectOption(opt: SelectOption) {
    onChange?.(opt.value)
    closeDropdown()
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        e.preventDefault()
        openDropdown()
        break
      case 'ArrowUp':
        e.preventDefault()
        openDropdown()
        break
    }
  }

  function handleListKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev < enabledOptions.length - 1 ? prev + 1 : 0
        )
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : enabledOptions.length - 1
        )
        break
      }
      case 'Home': {
        e.preventDefault()
        setHighlightedIndex(0)
        break
      }
      case 'End': {
        e.preventDefault()
        setHighlightedIndex(enabledOptions.length - 1)
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < enabledOptions.length) {
          selectOption(enabledOptions[highlightedIndex]!)
        }
        break
      }
      case 'Escape': {
        e.preventDefault()
        closeDropdown()
        break
      }
    }
  }

  React.useEffect(() => {
    if (open && listRef.current) {
      listRef.current.focus()
    }
  }, [open])

  React.useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll('[role="option"]')
    const item = items[highlightedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        id={id}
        aria-expanded={open}
        aria-haspopup="listbox"
        // Only while the list exists. It is never in the server HTML, so a useId that differs
        // between server and browser (when the tree above renders differently) can't mismatch.
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg px-3 text-sm',
          'bg-[var(--surface)] text-[var(--fg)]',
          'border border-[var(--border)]',
          'transition-colors duration-150',
          'hover:border-[var(--muted)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          !selectedOption && 'text-[var(--muted)]'
        )}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </button>

      <Popover
        open={open}
        onClose={closeDropdown}
        anchorRef={triggerRef}
        position="bottom"
        className="min-w-[var(--trigger-width)] max-h-60 overflow-hidden"
      >
        <ul
          ref={listRef}
          role="listbox"
          id={listboxId}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className="overflow-y-auto py-1 focus:outline-none max-h-60"
          style={{
            minWidth: triggerRef.current
              ? triggerRef.current.offsetWidth
              : undefined,
          }}
        >
          {options.map((opt, idx) => {
            const enabledIdx = enabledOptions.indexOf(opt)
            const isHighlighted = enabledIdx === highlightedIndex
            const isSelected = opt.value === value

            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled}
                data-index={idx}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer',
                  'transition-colors duration-75',
                  isHighlighted && 'bg-[var(--surface-hover)]',
                  isSelected && 'text-[var(--accent)]',
                  !isSelected && 'text-[var(--fg)]',
                  opt.disabled && 'cursor-not-allowed opacity-50'
                )}
                onClick={() => {
                  if (!opt.disabled) selectOption(opt)
                }}
                onMouseEnter={() => {
                  if (!opt.disabled) setHighlightedIndex(enabledIdx)
                }}
              >
                <span className="w-4 shrink-0">
                  {isSelected && <Check className="h-4 w-4" />}
                </span>
                <span className="truncate">{opt.label}</span>
              </li>
            )
          })}
        </ul>
      </Popover>
    </div>
  )
}

export { Select }
