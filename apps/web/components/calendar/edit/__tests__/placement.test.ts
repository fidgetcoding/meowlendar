import { describe, expect, it } from 'vitest'
import { GAP, MARGIN, placePopover } from '../placement'

const view = { width: 1440, height: 900 }
const card = { width: 420, height: 560 }

describe('where the editor opens', () => {
  it('beside the item on the right, caret pointing at it', () => {
    const p = placePopover({ left: 300, top: 200, width: 140, height: 60 }, card, view)
    expect(p.side).toBe('right')
    expect(p.left).toBe(300 + 140 + GAP)
    // The caret lands on the item's height range.
    expect(p.top + p.arrow).toBeGreaterThanOrEqual(200)
    expect(p.top + p.arrow).toBeLessThanOrEqual(260)
  })

  it('flips to the left near the right edge', () => {
    const p = placePopover({ left: 1150, top: 200, width: 140, height: 60 }, card, view)
    expect(p.side).toBe('left')
    expect(p.left + card.width).toBe(1150 - GAP)
  })

  it('goes below (or above) when neither side has room', () => {
    const narrow = { width: 700, height: 900 }
    const below = placePopover({ left: 200, top: 100, width: 300, height: 40 }, card, narrow)
    expect(below.side).toBe('bottom')
    expect(below.top).toBe(100 + 40 + GAP)
    const above = placePopover({ left: 200, top: 800, width: 300, height: 40 }, { width: 420, height: 500 }, narrow)
    expect(above.side).toBe('top')
    expect(above.top + 500).toBe(800 - GAP)
  })

  it('always stays fully on screen', () => {
    for (const anchor of [
      { left: 300, top: -50, width: 140, height: 40 },
      { left: 300, top: 880, width: 140, height: 40 },
      { left: 1300, top: 860, width: 140, height: 40 },
    ]) {
      const p = placePopover(anchor, card, view)
      expect(p.left).toBeGreaterThanOrEqual(MARGIN)
      expect(p.top).toBeGreaterThanOrEqual(MARGIN)
      expect(p.left + card.width).toBeLessThanOrEqual(view.width - MARGIN)
      expect(p.top + card.height).toBeLessThanOrEqual(view.height - MARGIN)
    }
  })

  it('pins a card taller than the screen to the top margin (it scrolls inside)', () => {
    const p = placePopover({ left: 300, top: 400, width: 140, height: 60 }, { width: 420, height: 2000 }, view)
    expect(p.top).toBe(MARGIN)
  })
})
