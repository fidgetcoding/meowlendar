'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_COLORS = [
  '#e8930c', // My Calendar
  '#5a68d4', // Work
  '#cf5d78', // Personal
  '#2b93b4', // Gym
  '#7986cb', // Lavender
  '#33b679', // Sage
  '#8e24aa', // Grape
  '#e67c73', // Flamingo
  '#f6bf26', // Banana
  '#f4511e', // Tangerine
  '#039be5', // Peacock
  '#616161', // Graphite
  '#3f51b5', // Blueberry
  '#0b8043', // Basil
  '#d50000', // Tomato
  '#f09300', // Mandarin
  '#4285f4', // Calendar Blue
  '#795548', // Cocoa
  '#ef6c00', // Pumpkin
  '#c0ca33', // Avocado
  '#009688', // Eucalyptus
  '#ad1457', // Cherry Blossom
  '#6f7ae0', // Periwinkle
  '#e91e63', // Pink
]

export interface ColorPickerProps {
  value?: string
  onChange?: (color: string) => void
  colors?: string[]
  allowCustom?: boolean
  className?: string
}

function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)
}

function normalizeHex(hex: string): string {
  const clean = hex.replace(/^#/, '')
  if (clean.length === 3) {
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase()
  }
  return `#${clean}`.toLowerCase()
}

function ColorPicker({
  value,
  onChange,
  colors = DEFAULT_COLORS,
  allowCustom = true,
  className,
}: ColorPickerProps) {
  const [showCustom, setShowCustom] = React.useState(false)
  const [customInput, setCustomInput] = React.useState('')
  const customInputRef = React.useRef<HTMLInputElement>(null)

  const normalizedValue = value ? normalizeHex(value) : undefined

  function handleSwatchClick(color: string) {
    onChange?.(color)
  }

  function handleCustomSubmit() {
    const hex = customInput.startsWith('#') ? customInput : `#${customInput}`
    if (isValidHex(hex)) {
      onChange?.(normalizeHex(hex))
      setShowCustom(false)
      setCustomInput('')
    }
  }

  function handleCustomKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCustomSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowCustom(false)
      setCustomInput('')
    }
  }

  React.useEffect(() => {
    if (showCustom && customInputRef.current) {
      customInputRef.current.focus()
    }
  }, [showCustom])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        className="grid grid-cols-5 gap-2"
        role="radiogroup"
        aria-label="Color selection"
      >
        {colors.map((color) => {
          const isSelected = normalizedValue === normalizeHex(color)

          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={color}
              onClick={() => handleSwatchClick(color)}
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded-full',
                'transition-all duration-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]',
                isSelected && 'ring-2 ring-white ring-offset-2 ring-offset-[var(--surface)]'
              )}
              style={{ backgroundColor: color }}
            >
              {isSelected && (
                <Check
                  className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                  strokeWidth={3}
                />
              )}
            </button>
          )
        })}
      </div>

      {allowCustom && (
        <>
          {showCustom ? (
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 shrink-0 rounded-full border border-[var(--border)]"
                style={{
                  backgroundColor:
                    customInput && isValidHex(customInput.startsWith('#') ? customInput : `#${customInput}`)
                      ? (customInput.startsWith('#') ? customInput : `#${customInput}`)
                      : 'transparent',
                }}
              />
              <div className="flex flex-1 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 h-8">
                <span className="text-sm text-[var(--muted)]">#</span>
                <input
                  ref={customInputRef}
                  type="text"
                  value={customInput.replace(/^#/, '')}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                    setCustomInput(val)
                  }}
                  onKeyDown={handleCustomKeyDown}
                  placeholder="f9a825"
                  maxLength={6}
                  className={cn(
                    'flex-1 bg-transparent text-sm text-[var(--fg)]',
                    'placeholder:text-[var(--muted)]',
                    'focus:outline-none',
                    'min-w-0'
                  )}
                  aria-label="Custom hex color"
                />
              </div>
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customInput || !isValidHex(`#${customInput.replace(/^#/, '')}`)}
                className={cn(
                  'rounded-lg px-3 h-8 text-xs font-medium',
                  'bg-[var(--accent)] text-[var(--bg)]',
                  'hover:bg-[var(--accent-hover)]',
                  'transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                  'disabled:opacity-50 disabled:pointer-events-none'
                )}
              >
                Set
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className={cn(
                'w-full rounded-lg py-1.5 text-xs font-medium',
                'text-[var(--muted)] hover:text-[var(--fg)]',
                'border border-dashed border-[var(--border)]',
                'hover:bg-[var(--surface-hover)]',
                'transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
              )}
            >
              Custom color
            </button>
          )}
        </>
      )}
    </div>
  )
}

export { ColorPicker, DEFAULT_COLORS }
