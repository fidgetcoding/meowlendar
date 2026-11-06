import { test, expect, type Page, type Locator } from './test'
import { SEED } from './seed'

const E2E_LIVE = !!process.env.E2E_BASE

/**
 * Enter the full kanban board: open the task panel from the ribbon, then flip
 * the sidebar/board toggle to board mode (the desktop kanban entry point, #37).
 */
async function openBoard(page: Page) {
  await page.getByRole('button', { name: 'Tasks', exact: true }).first().click()
  await page.getByRole('button', { name: 'Board view', exact: true }).click()
  await expect(page.getByText('Backlog', { exact: true })).toBeVisible()
}

/**
 * Manual pointer drag from a card into a target column. @dnd-kit's PointerSensor
 * is distance-activated, so dragTo() does not work — we press, move past the
 * threshold, then step to the column's drop zone.
 */
async function dragCardToColumn(page: Page, card: Locator, status: string) {
  // Press on the card body (its title), the way a person grabs a card. The grip
  // handle is invisible until hover, so a drag that only works from it is broken.
  const handle = card.locator('.meow-card-ttl').first()
  const handleBox = await handle.boundingBox()
  const column = page.locator(`[data-kanban-column="${status}"]`)
  const colBox = await column.boundingBox()
  if (!handleBox || !colBox) throw new Error('missing drag geometry')

  const sx = handleBox.x + handleBox.width / 2
  const sy = handleBox.y + handleBox.height / 2
  const tx = colBox.x + colBox.width / 2
  const ty = colBox.y + Math.min(140, colBox.height / 2)

  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 8, sy + 8) // exceed the 5px activation distance
  await page.mouse.move(tx, ty, { steps: 16 })
  await page.mouse.move(tx, ty) // settle over the drop zone
  await page.mouse.up()
}

test.describe('kanban board', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')
    await page.goto('/')
  })

  test('board view toggle reveals the four columns', async ({ page }) => {
    await openBoard(page)
    for (const col of ['Backlog', 'In Progress', 'Check', 'Done']) {
      await expect(page.getByText(col, { exact: true })).toBeVisible()
    }
  })

  test('a column header + creates a task in that column', async ({ page }) => {
    await openBoard(page)
    await page.getByRole('button', { name: /add task to backlog/i }).click()

    // Unique title per run so repeated runs never collide on the match.
    const title = `${SEED.createdTaskPrefix} ${Date.now()}`
    const input = page.getByPlaceholder(/task title/i)
    await input.fill(title)

    // Wait for the atomic task/tag transaction to commit before checking the card.
    const inserted = page.waitForResponse(
      (r) => r.url().includes('/rest/v1/rpc/create_task_with_children') && r.request().method() === 'POST' && r.ok(),
      { timeout: 15_000 }
    )
    await page.getByRole('button', { name: /^create$/i }).click()
    await inserted

    // The new card lands in the Backlog column.
    await expect(
      page.locator('[data-kanban-column="backlog"]').getByText(title)
    ).toBeVisible({ timeout: 15_000 })
  })

  test('a card can be dragged between columns', async ({ page }) => {
    await openBoard(page)

    // The seeded drag card is the first card in Backlog (lowest position).
    const card = page.locator(`[data-task-card][data-task-id="${SEED.kanbanTaskId}"]`)
    await expect(card).toBeVisible()

    await dragCardToColumn(page, card, 'in_progress')

    // Moving columns changes status: the card now lives under In Progress.
    await expect(
      page.locator('[data-kanban-column="in_progress"]').locator(
        `[data-task-id="${SEED.kanbanTaskId}"]`
      )
    ).toBeVisible()
  })
})
