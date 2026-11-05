'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import type { AnchorRect } from '@/lib/stores/ui-store'
import { placePopover, type PopoverPlacement } from './placement'

/** Below this width the editor is a bottom sheet. */
export const PHONE_MAX_PX = 640

interface EditPopoverProps {
  /** The slot or item to open beside. */
  anchor: AnchorRect | null
  /** Without an anchor, the grid item to find and open beside (when it's on screen). */
  anchorItemId?: string | null
  label: string
  /** A press outside the card. The form decides whether that closes it. */
  onOutsidePress: () => void
  children: React.ReactNode
}

type Layout =
  | { mode: 'measuring' }
  | { mode: 'sheet' }
  | { mode: 'centred' }
  | { mode: 'anchored'; placement: PopoverPlacement }

/** The on-screen box of a grid item, or null when it isn't drawn or is scrolled out of view. */
export function findItemRect(itemId: string | null | undefined): AnchorRect | null {
  if (!itemId || typeof document === 'undefined') return null
  const id = itemId.replace(/["\\]/g, '\\$&')
  const el = document.querySelector<HTMLElement>(`[data-calendar-item][data-item-id="${id}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
  return onScreen ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
}

/**
 * The floating card the event / task / routine editor lives in: beside its item with a caret
 * pointing at it, flipping to stay on screen; a centred card when the item isn't on the grid;
 * a bottom sheet on phones.
 */
export function EditPopover({ anchor, anchorItemId, label, onOutsidePress, children }: EditPopoverProps) {
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = React.useState(false)
  const [layout, setLayout] = React.useState<Layout>({ mode: 'measuring' })
  // The item's box is read once when the editor opens; it doesn't follow later scrolling.
  const [itemRect] = React.useState(() => anchor ?? findItemRect(anchorItemId))
  const outsideRef = React.useRef(onOutsidePress)
  outsideRef.current = onOutsidePress

  React.useEffect(() => setMounted(true), [])

  const place = React.useCallback(() => {
    const view = { width: window.innerWidth, height: window.innerHeight }
    if (view.width < PHONE_MAX_PX) return setLayout({ mode: 'sheet' })
    if (!itemRect || !cardRef.current) return setLayout({ mode: 'centred' })
    const card = { width: cardRef.current.offsetWidth, height: cardRef.current.offsetHeight }
    setLayout({ mode: 'anchored', placement: placePopover(itemRect, card, view) })
  }, [itemRect])

  React.useLayoutEffect(() => {
    if (!mounted) return
    place()
    const card = cardRef.current
    const observer = typeof ResizeObserver !== 'undefined' && card ? new ResizeObserver(place) : null
    if (card) observer?.observe(card)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [mounted, place])

  // A press anywhere but the card (or a dialog / menu it opened) is an outside press.
  React.useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Element | null
      if (!target || cardRef.current?.contains(target)) return
      if (target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return
      // After this press reaches the page, so the grid still sees the editor open and treats the
      // press as dismissing it, rather than as a click that starts a new item.
      setTimeout(() => outsideRef.current(), 0)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [])

  if (!mounted) return null

  const anchored = layout.mode === 'anchored' ? layout.placement : null
  const style: React.CSSProperties = anchored
    ? { left: anchored.left, top: anchored.top }
    : layout.mode === 'measuring'
      ? { left: -10000, top: 0 } // off screen, not hidden, so the title can take focus meanwhile
      : {}

  return createPortal(
    <>
      {(layout.mode === 'sheet' || layout.mode === 'centred') && <div className="meow-ef-scrim" aria-hidden="true" />}
      <div
        ref={cardRef}
        role="dialog"
        aria-label={label}
        data-placement={anchored?.side ?? layout.mode}
        className={cn('meow-ef', layout.mode === 'sheet' && 'is-sheet', layout.mode === 'centred' && 'is-centred')}
        style={style}
      >
        {anchored && (
          <span
            className={cn('meow-ef-caret', `is-${anchored.side}`)}
            style={anchored.side === 'left' || anchored.side === 'right' ? { top: anchored.arrow } : { left: anchored.arrow }}
            aria-hidden="true"
          />
        )}
        {children}
      </div>
    </>,
    document.body,
  )
}
