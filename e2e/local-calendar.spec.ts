import { test, expect, type Page } from '@playwright/test'

// A brand new account with no Google connected: its own sign-up, no seeded data.
const E2E_LIVE = !!process.env.E2E_BASE
const EVENT = '[data-calendar-item][data-item-type="event"]'

test.use({ storageState: { cookies: [], origins: [] } })

async function signUp(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByRole('textbox', { name: /email/i }).fill(
    `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  )
  await page.locator('input[type="password"]').fill('correct-horse-battery-1')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.locator('[data-day-column]').first().waitFor({ state: 'visible' })
  // The default calendar has to have loaded before quick-create can use it.
  await page.waitForLoadState('networkidle')
}

/** Local noon on the first day shown, so it lands in the visible grid. */
async function firstVisibleDay(page: Page): Promise<Date> {
  const res = await page.request.get('/api/calendars')
  expect(res.ok()).toBe(true)
  const now = new Date()
  const sunday = new Date(now)
  sunday.setHours(12, 0, 0, 0)
  sunday.setDate(now.getDate() - now.getDay())
  return sunday
}

async function localCalendarId(page: Page): Promise<string> {
  const res = await page.request.get('/api/calendars')
  const body = (await res.json()) as { local_calendars: { id: string }[] }
  return body.local_calendars[0]!.id
}

test.describe('local calendar, no Google', () => {
  test.beforeEach(() => {
    test.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')
  })

  test('creates an event from the grid, and it survives a reload', async ({ page }) => {
    await signUp(page)
    const column = page.locator('[data-day-column]').first()
    await column.dblclick({ position: { x: 30, y: 300 } })
    const title = page.getByPlaceholder(/add title/i)
    await title.fill('Local event')
    await title.press('Enter')

    await expect(page.locator(EVENT).filter({ hasText: 'Local event' })).toBeVisible()
    await page.reload()
    await expect(page.locator(EVENT).filter({ hasText: 'Local event' })).toBeVisible()
  })

  test('shows every occurrence of a recurring event and deletes just one', async ({ page }) => {
    await signUp(page)
    const start = await firstVisibleDay(page)
    const res = await page.request.post('/api/events', {
      data: {
        calendar_id: await localCalendarId(page),
        title: 'Daily local',
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + 30 * 60_000).toISOString(),
        timezone: 'UTC',
        recurrence_rule: 'FREQ=DAILY;COUNT=7',
      },
    })
    expect(res.status()).toBe(201)

    await page.reload()
    const occurrences = page.locator(EVENT).filter({ hasText: 'Daily local' })
    await expect(occurrences).toHaveCount(7)

    // The grid scrolls under its sticky header, so send the click to the item itself.
    await occurrences.nth(2).dispatchEvent('click')
    await page.getByRole('button', { name: /delete/i }).first().click()
    // "Only this occurrence" is already selected.
    await expect(page.getByRole('heading', { name: /delete recurring item/i })).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()

    await expect(occurrences).toHaveCount(6)
    await page.reload()
    await expect(page.locator(EVENT).filter({ hasText: 'Daily local' })).toHaveCount(6)
  })

  test('adds a second local calendar in settings', async ({ page }) => {
    await signUp(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Calendars' }).first().click()
    await expect(page.getByLabel('Name of My Calendar')).toBeVisible()
    await page.getByLabel('New local calendar name').fill('Side project')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByLabel('Name of Side project')).toBeVisible()
  })
})
