'use client'

import * as React from 'react'
import { Copy, Check } from 'lucide-react'
import {
  DAYS,
  DAY_LABELS,
  SLOTS_PER_DAY,
  SLOT_MINUTES,
  cellKey,
  slotToTime,
  applyPaint,
  paintedToRanges,
  rangesToPainted,
  formatRangesAsText,
  type Day,
  type AvailabilityRange,
} from '@/lib/booking/ranges'

// ---------------------------------------------------------------------------
// Drag-to-paint weekly availability editor (spec #54). All range math lives in
// lib/booking/ranges.ts (unit-tested); this component only owns the drag state
// and rendering. Dragging paints 30-minute cells; the painted set round-trips to
// the stored [{day, start, end}] shape via the pure module.
// ---------------------------------------------------------------------------

interface DragState {
  day: Day
  startSlot: number
  mode: 'add' | 'erase'
}

// Only render a business-hours band by default so the grid stays compact; the
// underlying model is still full-resolution (00:00–24:00).
const FIRST_SLOT = 12 // 06:00
const LAST_SLOT = 44 // 22:00 (exclusive upper cell 43 = 21:30-22:00)

export function AvailabilityGridEditor({
  value,
  onChange,
}: {
  value: AvailabilityRange[]
  onChange: (ranges: AvailabilityRange[]) => void
}) {
  const [painted, setPainted] = React.useState<Set<string>>(() => rangesToPainted(value))
  const [drag, setDrag] = React.useState<DragState | null>(null)
  const [preview, setPreview] = React.useState<Set<string> | null>(null)
  const [copied, setCopied] = React.useState(false)

  // Re-seed when the caller swaps to a different link (value identity changes).
  const seededRef = React.useRef(value)
  React.useEffect(() => {
    if (seededRef.current !== value) {
      seededRef.current = value
      setPainted(rangesToPainted(value))
    }
  }, [value])

  const commit = React.useCallback(
    (next: Set<string>) => {
      setPainted(next)
      onChange(paintedToRanges(next))
    },
    [onChange]
  )

  const endDrag = React.useCallback(() => {
    if (drag && preview) commit(preview)
    setDrag(null)
    setPreview(null)
  }, [drag, preview, commit])

  React.useEffect(() => {
    if (!drag) return
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [drag, endDrag])

  function startDrag(day: Day, slot: number) {
    const isPainted = painted.has(cellKey(day, slot))
    const mode: 'add' | 'erase' = isPainted ? 'erase' : 'add'
    setDrag({ day, startSlot: slot, mode })
    setPreview(applyPaint(painted, day, slot, slot, mode))
  }

  function extendDrag(day: Day, slot: number) {
    if (!drag || drag.day !== day) return
    setPreview(applyPaint(painted, day, drag.startSlot, slot, drag.mode))
  }

  const shown = preview ?? painted
  const ranges = paintedToRanges(painted)
  const textLines = formatRangesAsText(ranges)

  async function copyText() {
    try {
      await navigator.clipboard.writeText(textLines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard denied — ignore
    }
  }

  const rows: number[] = []
  for (let s = FIRST_SLOT; s < LAST_SLOT; s++) rows.push(s)

  return (
    <div className="select-none" data-testid="availability-grid">
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {/* Day header */}
          <div className="grid" style={{ gridTemplateColumns: `48px repeat(${DAYS.length}, 1fr)` }}>
            <div />
            {DAYS.map((d) => (
              <div
                key={d}
                className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]"
              >
                {DAY_LABELS[d]}
              </div>
            ))}
          </div>

          {/* Cell rows */}
          {rows.map((slot) => {
            const onHour = slot % 2 === 0
            return (
              <div
                key={slot}
                className="grid"
                style={{ gridTemplateColumns: `48px repeat(${DAYS.length}, 1fr)` }}
              >
                <div className="pr-1 text-right text-[10px] leading-[16px] text-[var(--muted)]">
                  {onHour ? slotToTime(slot) : ''}
                </div>
                {DAYS.map((day) => {
                  const key = cellKey(day, slot)
                  const active = shown.has(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`${DAY_LABELS[day]} ${slotToTime(slot)}${active ? ' (available)' : ''}`}
                      aria-pressed={active}
                      data-day={day}
                      data-slot={slot}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        startDrag(day, slot)
                      }}
                      onMouseEnter={() => extendDrag(day, slot)}
                      className={`h-4 border-[var(--border)] transition-colors ${
                        onHour ? 'border-t' : 'border-t border-dashed'
                      }`}
                      style={{
                        backgroundColor: active ? 'var(--accent)' : 'transparent',
                        borderLeft: day === DAYS[0] ? '1px solid var(--border)' : undefined,
                        borderRight: '1px solid var(--border)',
                      }}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Painted ranges as text + copy */}
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            Available times
          </span>
          <button
            type="button"
            onClick={copyText}
            disabled={textLines.length === 0}
            className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40"
            aria-label="Copy availability as text"
          >
            {copied ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
            Copy as text
          </button>
        </div>
        {textLines.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            Drag across the grid to paint your available blocks.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {textLines.map((line) => (
              <li key={line} className="text-xs text-[var(--fg)]">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-1 text-[10px] text-[var(--muted)]">
        {SLOT_MINUTES}-minute cells · showing {slotToTime(FIRST_SLOT)} - {slotToTime(LAST_SLOT)}.
        Full-day painting is preserved even if outside this view.
      </p>
      <input type="hidden" data-testid="painted-count" value={paintedCount(painted)} readOnly />
    </div>
  )
}

function paintedCount(painted: Set<string>): number {
  let n = 0
  for (const k of painted) {
    const slot = Number(k.split(':')[1])
    if (Number.isInteger(slot) && slot >= 0 && slot < SLOTS_PER_DAY) n++
  }
  return n
}
