import { test, expect, type Locator } from './test'

/**
 * Waits until the grid stops re-laying itself. Saved display settings arrive with the profile
 * after the first render and change the start hour and column widths, which moves every column.
 */
async function waitForSettledGrid(day: Locator, scroller: Locator) {
  let last = ''
  await expect
    .poll(
      async () => {
        const box = await day.boundingBox()
        const height = await scroller.evaluate((el) => el.scrollHeight)
        const now = JSON.stringify({ x: box?.x, width: box?.width, height })
        const settled = now === last
        last = now
        return settled
      },
      { intervals: [250] },
    )
    .toBe(true)
}

test('the calendar scrolls through the full day in both directions', async ({ page }) => {
  test.skip(!process.env.E2E_BASE, 'Requires the authenticated local stack')
  await page.goto('/')
  const day = page.locator('[data-day-column]').first()
  await expect(day).toBeVisible()
  const scroller = day.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " overflow-y-auto ")][1]')
  await waitForSettledGrid(day, scroller)
  const dimensions = await scroller.evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }))
  expect(dimensions.content).toBeGreaterThan(dimensions.height)
  await scroller.evaluate((el) => { el.scrollTop = 0 })
  // Point at the middle of the grid, below its sticky day header. A spot near the top of a day
  // column sits just under that header, and when a first hover attempt finds the grid still
  // moving, Playwright's retries scroll the tall column so that spot is covered or out of view.
  await scroller.hover()
  await page.mouse.wheel(0, 5000)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.mouse.wheel(0, -5000)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0)
})
