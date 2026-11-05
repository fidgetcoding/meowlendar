'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { RsvpAnswer } from '@/lib/hooks/use-events'
import type { RsvpCopy } from './event-copies'

/** The quiet line under a meeting merged from several calendars: "Also on Work · Personal". */
export function AlsoOnLine({ labels, className }: { labels: string[]; className?: string }) {
  if (labels.length === 0) return null
  return <p className={cn('text-xs text-[var(--muted)] truncate', className)}>Also on {labels.join(' · ')}</p>
}

const ANSWERS: { value: RsvpAnswer; label: string }[] = [
  { value: 'accepted', label: 'Yes' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'declined', label: 'No' },
]

/**
 * Yes / Maybe / No for an invitation. When it reached several of your accounts you pick
 * which one answers, the copy shown first. A reply that fails stays on screen.
 */
export function RsvpRow({
  copies,
  onRespond,
}: {
  copies: RsvpCopy[]
  onRespond: (eventId: string, answer: RsvpAnswer) => Promise<unknown>
}) {
  const [chosen, setChosen] = React.useState(0)
  const [answered, setAnswered] = React.useState<Record<string, RsvpAnswer>>({})
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const copy = copies[chosen]
  if (!copy) return null
  const current = answered[copy.eventId] ?? copy.response

  const respond = async (answer: RsvpAnswer) => {
    setPending(true)
    setError(null)
    try {
      await onRespond(copy.eventId, answer)
      setAnswered((prev) => ({ ...prev, [copy.eventId]: answer }))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your reply didn't go through.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]" role="group" aria-label="Going?">
        <span>Going?</span>
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={pending}
            aria-pressed={current === a.value}
            onClick={() => respond(a.value)}
            className={cn(
              'px-2 py-0.5 rounded border border-[var(--border)] transition-colors duration-150',
              current === a.value ? 'bg-[var(--surface-hover)] text-[var(--fg)] font-medium' : 'hover:bg-[var(--surface-hover)]'
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      {copies.length > 1 && (
        <label className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
          <span>Answer as</span>
          <select
            value={chosen}
            onChange={(e) => {
              setChosen(Number(e.target.value))
              setError(null)
            }}
            className="bg-transparent text-[var(--fg)] truncate"
          >
            {copies.map((c, i) => (
              <option key={c.eventId} value={i}>{c.account}</option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  )
}
