// The loaf on the now line never covers event text (approved design, r4 app.js fitLoaf).
//
// Every text block of a today item that crosses the loaf's drawn box (ear tips to belly, whiskers
// to tail) gets a right margin so it ends before the loaf. A title that still doesn't fit drops to
// one line with an ellipsis. Runs after each render of today's column, on resize and on font load.
//
// Items mark their parts: [data-fit-part] on each text block, [data-fit-title] on the title text,
// [data-fit-box] on the padded box (defaults to the item itself).

const FIT_ATTR = 'data-loaf-fit'

export function fitLoaf(column: HTMLElement): void {
  const items = Array.from(column.querySelectorAll<HTMLElement>('[data-calendar-item]'))
  for (const item of items) {
    item.removeAttribute(FIT_ATTR)
    item.querySelectorAll<HTMLElement>('[data-fit-part]').forEach((part) => {
      part.style.marginRight = ''
    })
  }

  const cat = column.querySelector<SVGElement>('[data-now-loaf] svg')
  if (!cat) return
  const r = cat.getBoundingClientRect()
  // The loaf's drawn box inside its 120 x 66 viewBox: from x 3 and y 15 to the bottom edge.
  const loaf = {
    left: r.left + (r.width * 3) / 120 - 4,
    top: r.top + (r.height * 15) / 66 - 3,
    bottom: r.bottom + 2,
  }

  for (const item of items) {
    const box = item.querySelector<HTMLElement>('[data-fit-box]') ?? item
    const er = box.getBoundingClientRect()
    if (er.bottom <= loaf.top || er.top >= loaf.bottom || er.right <= loaf.left) continue
    const edge = er.right - parseFloat(getComputedStyle(box).paddingRight || '0')
    const parts = Array.from(item.querySelectorAll<HTMLElement>('[data-fit-part]'))
    const title = item.querySelector<HTMLElement>('[data-fit-title]')

    // Moving one block can reflow the others, so settle in a few passes.
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      for (const part of parts) {
        const pr = part.getBoundingClientRect()
        if (!pr.height) continue
        const hit = pr.bottom > loaf.top && pr.top < loaf.bottom
        const want = hit ? `${Math.ceil(Math.max(0, edge - loaf.left))}px` : ''
        if (part.style.marginRight !== want) {
          part.style.marginRight = want
          moved = true
        }
      }
      if (title && !item.hasAttribute(FIT_ATTR) && title.scrollWidth > title.clientWidth + 1) {
        item.setAttribute(FIT_ATTR, '')
        moved = true
      }
      if (!moved) break
    }
  }
}
