import { test, expect } from './test'

test('the calendar scrolls through the full day in both directions', async ({ page }) => {
  test.skip(!process.env.E2E_BASE, 'Requires the authenticated local stack')
  await page.goto('/')
  const day = page.locator('[data-day-column]').first()
  await expect(day).toBeVisible()
  const scroller = day.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " overflow-y-auto ")][1]')
  const dimensions = await scroller.evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }))
  expect(dimensions.content).toBeGreaterThan(dimensions.height)
  await scroller.evaluate((el) => { el.scrollTop = 0 })
  await day.hover({ position: { x: 20, y: 20 } })
  await page.mouse.wheel(0, 5000)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.mouse.wheel(0, -5000)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0)
})
