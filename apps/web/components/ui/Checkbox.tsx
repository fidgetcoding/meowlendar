'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, checked, defaultChecked, onCheckedChange, onChange, ...props }, ref) => {
    const generatedId = React.useId()
    const checkboxId = id || generatedId
    const isControlled = checked !== undefined
    const [internalChecked, setInternalChecked] = React.useState(defaultChecked ?? false)
    const isChecked = isControlled ? checked : internalChecked

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      if (!isControlled) {
        setInternalChecked(e.target.checked)
      }
      onChange?.(e)
      onCheckedChange?.(e.target.checked)
    }

    return (
      <label
        htmlFor={checkboxId}
        className={cn(
          'inline-flex items-center gap-2 cursor-pointer select-none',
          props.disabled && 'cursor-not-allowed opacity-50',
          className
        )}
      >
        <span className="relative flex items-center justify-center">
          <input
            type="checkbox"
            id={checkboxId}
            ref={ref}
            checked={isControlled ? checked : undefined}
            defaultChecked={!isControlled ? defaultChecked : undefined}
            onChange={handleChange}
            className="peer sr-only"
            {...props}
          />
          <span
            className={cn(
              'flex h-[18px] w-[18px] items-center justify-center rounded',
              'border border-[var(--border)]',
              'bg-[var(--surface)]',
              'transition-colors duration-150',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--bg)]',
              isChecked && 'bg-[var(--accent)] border-[var(--accent)]'
            )}
            aria-hidden="true"
          >
            <Check
              className={cn(
                'h-3 w-3 text-[var(--bg)]',
                'transition-opacity duration-100',
                isChecked ? 'opacity-100' : 'opacity-0'
              )}
              strokeWidth={3}
            />
          </span>
        </span>
        {label && (
          <span className="text-sm text-[var(--fg)]">{label}</span>
        )}
      </label>
    )
  }
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
