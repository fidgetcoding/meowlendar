import { test, expect, type Page, type Locator } from './test'
import { SEED } from './seed'

// DB-dependent calendar-grid flows (#12–#15). These require a live Supabase
// stack + an authenticated session + the seeded baseline (seed.setup.ts);
// without E2E_BASE they skip cleanly so the suite stays green until a stack is
// wired.
const E2E_LIVE = !!process.env.E2E_BASE

const EVENT = '[data-calendar-item][data-item-type="event"]'

/**
 * Manual pointer drag. Playwright's dragTo() does not satisfy @dnd-kit's
 * distance-activated sensors — they need a real pointerdown, a move past the
 * activation threshold, then stepped moves to the target.
 */
async function dragBy(page: Page, source: Locator, dx: number, dy: number) {
  await source.scrollIntoViewIfNeeded()
  const box = await source.boundingBox()
  if (!box) throw new Error('drag source has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 6, startY + 6) // exceed the 5px activation distance
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 })
  await page.mouse.move(startX + dx, startY + dy) // settle before release
  await page.mouse.up()
}

test.describe('calendar item CRUD (#12–#15)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')
    await page.goto('/')
    // Week view is the default; wait for the grid to render rather than a
    // button that does not exist.
    await page.locator('[data-day-column]').first().waitFor({ state: 'visible' })
  })

  test('#12 double-click an empty slot creates an item', async ({ page }) => {
    // The first column is an empty day, so the slot is free.
    const column = page.locator('[data-day-column]').first()
    await column.dblclick({ position: { x: 30, y: 300 } })
    // The editor popup opens beside the new slot, its title field focused.
    const editor = page.getByRole('dialog', { name: /new event/i })
    await expect(editor).toBeVisible()
    await expect(editor.getByPlaceholder(/add title/i)).toBeFocused()
    // Beside the slot: the card starts to the right of the column (or ends left of it).
    const [card, col] = await Promise.all([editor.boundingBox(), column.boundingBox()])
    expect(card!.x >= col!.x + col!.width || card!.x + card!.width <= col!.x).toBe(true)
  })

  test('#12 single click on an empty slot still offers quick add', async ({ page }) => {
    const column = page.locator('[data-day-column]').first()
    await column.click({ position: { x: 30, y: 300 } })
    await expect(page.getByPlaceholder(/add title/i)).toBeVisible()
    await expect(page.getByRole('dialog', { name: /new event/i })).toHaveCount(0)
  })

  test('#12 click-drag on an empty slot sets a duration', async ({ page }) => {
    const column = page.locator('[data-day-column]').first()
    // Bring an empty slot into view, then drag down over it to sweep a range.
    await column.hover({ position: { x: 30, y: 300 } })
    const box = await column.boundingBox()
    if (!box) throw new Error('no day column')
    const x = box.x + 30
    const y = box.y + 300
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 90, { steps: 8 })
    await page.mouse.up()
    // A range drag opens the editor popup beside the new slot.
    await expect(page.getByRole('dialog', { name: /new event/i })).toBeVisible()
    await expect(page.getByPlaceholder(/add title/i)).toBeFocused()
  })

  test('#12 right-click an empty slot offers create event/task/routine', async ({ page }) => {
    const column = page.locator('[data-day-column]').first()
    await column.click({ button: 'right', position: { x: 20, y: 240 } })
    const menu = page.getByRole('menu')
    await expect(menu.getByText(/create event/i)).toBeVisible()
    await expect(menu.getByText(/create task/i)).toBeVisible()
    await expect(menu.getByText(/create routine/i)).toBeVisible()
  })

  test('#13 double-click an item opens the edit form with three tabs', async ({ page }) => {
    await page.locator(EVENT).first().dblclick()
    await expect(page.getByRole('dialog', { name: /edit event/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^event$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^task$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^routine$/i })).toBeVisible()
  })

  test('#13 converting a saved event to a task warns about attendees', async ({ page }) => {
    await page.locator(EVENT).first().dblclick()
    // Switch to the Task tab, then save to trigger the event -> task conversion.
    await page.getByRole('button', { name: /^task$/i }).click()
    // The seeded event has an attendee, so conversion must confirm the Google
    // cancellation before proceeding. window.confirm blocks the click until the
    // dialog is answered, so dismiss it inside the handler (declining the
    // conversion leaves the event intact), then assert on the captured copy.
    let dialogMessage = ''
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message()
      await dialog.dismiss()
    })
    await page.getByRole('button', { name: /^save$/i }).click()
    await expect
      .poll(() => dialogMessage)
      .toMatch(/attendee|cancellation|google calendar/i)
  })

  test('#14 dragging an event changes its time', async ({ page }) => {
    const item = page.locator(EVENT).first()
    await expect(item).toBeVisible()
    const before = await item.innerText()
    await dragBy(page, item, 0, 90) // drag straight down within the same day
    // Same row (stable data-item-id), but the rendered time range must change.
    await expect(page.locator(`[data-item-id="${SEED.eventId}"]`)).not.toHaveText(before)
  })

  test('#13 Esc closes the editor, and a press outside closes it while unchanged', async ({ page }) => {
    await page.locator(EVENT).first().dblclick()
    const editor = page.getByRole('dialog', { name: /edit event/i })
    await expect(editor).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)

    await page.locator(EVENT).first().dblclick()
    await expect(editor).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(editor).toHaveCount(0)
  })

  test('#13 a press outside keeps an edited form open', async ({ page }) => {
    await page.locator(EVENT).first().dblclick()
    const editor = page.getByRole('dialog', { name: /edit event/i })
    await editor.getByLabel('Title').fill('Changed title')
    await page.mouse.click(5, 5)
    await expect(editor).toBeVisible()
  })

  test('#15 single click opens the preview popover with quick actions', async ({ page }) => {
    await page.locator(EVENT).first().click()
    const popover = page.getByRole('dialog', { name: /preview/i })
    await expect(popover.getByRole('button', { name: /edit/i })).toBeVisible()
    await expect(popover.getByRole('button', { name: /delete/i })).toBeVisible()
  })
})
