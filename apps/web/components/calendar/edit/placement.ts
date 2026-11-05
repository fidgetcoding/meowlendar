import type { AnchorRect } from '@/lib/stores/ui-store'

// Where the editor card goes relative to the item it edits, like Morgen's popup: beside the item
// (right first, then left), else below or above it, always fully on screen. Pure, so it's tested
// without a browser.

export type PopoverSide = 'right' | 'left' | 'bottom' | 'top'

export interface PopoverPlacement {
  left: number
  top: number
  /** The side of the item the card sits on; the caret points back at the item from there. */
  side: PopoverSide
  /** Caret position along the card edge that faces the item, in px from the card's top/left. */
  arrow: number
}

export const GAP = 12
export const MARGIN = 8
const ARROW_INSET = 20
/** How far below the card's top the caret aims, so the header lines up with the item. */
const HEADER_AIM = 36

/** v kept within [lo, hi]; lo wins when the range is empty (a card taller than the screen). */
function within(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi)
}

export function placePopover(
  anchor: AnchorRect,
  card: { width: number; height: number },
  view: { width: number; height: number },
): PopoverPlacement {
  const height = Math.min(card.height, view.height - 2 * MARGIN)
  const fitsRight = anchor.left + anchor.width + GAP + card.width <= view.width - MARGIN
  const fitsLeft = anchor.left - GAP - card.width >= MARGIN

  if (fitsRight || fitsLeft) {
    const side: PopoverSide = fitsRight ? 'right' : 'left'
    const left = side === 'right' ? anchor.left + anchor.width + GAP : anchor.left - GAP - card.width
    // Aim at the item's top part: tall items still get the caret near their title.
    const aim = anchor.top + Math.min(anchor.height, 2 * HEADER_AIM) / 2
    const top = within(aim - HEADER_AIM, MARGIN, view.height - MARGIN - height)
    return { left, top, side, arrow: within(aim - top, ARROW_INSET, height - ARROW_INSET) }
  }

  const below = anchor.top + anchor.height + GAP
  const fitsBelow = below + height <= view.height - MARGIN
  const fitsAbove = anchor.top - GAP - height >= MARGIN
  const side: PopoverSide = fitsBelow || !fitsAbove ? 'bottom' : 'top'
  const top = within(side === 'bottom' ? below : anchor.top - GAP - height, MARGIN, view.height - MARGIN - height)
  const aimX = anchor.left + anchor.width / 2
  const left = within(aimX - card.width / 2, MARGIN, view.width - MARGIN - card.width)
  return { left, top, side, arrow: within(aimX - left, ARROW_INSET, card.width - ARROW_INSET) }
}

