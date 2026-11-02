import { test, expect, type Page } from './test'
import { SEED } from './seed'

// External booking happy path (#57b). Visits the path-based public booking page
// /book/{slug} for the seeded public link, picks a date + time slot, submits the
// form, and lands on the confirmation. Requires a live Supabase stack + the
// seeded baseline (seed.setup.ts); skips cleanly without E2E_BASE.
const E2E_LIVE = !!process.env.E2E_BASE

test.describe('external booking page (#57b)', () => {
  test.beforeEach(() => {
    test.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')
  })

  test('book a slot end-to-end on /book/{slug}', async ({ page }) => {
    await page.goto(`/book/${SEED.bookingSlug}`)
    await bookSlot(page, 0)
  })

  test('book a slot end-to-end on a booking subdomain', async ({ page, baseURL }) => {
    const base = new URL(baseURL!)
    test.skip(base.hostname !== 'localhost', 'subdomains need a localhost base URL')

    await page.goto(`${base.protocol}//${SEED_USERNAME}.localhost:${base.port}/${SEED.bookingSlug}`)
    // A different slot from the test above, which may run at the same time.
    await bookSlot(page, 5)
  })

  test('a booking subdomain lists the public links', async ({ page, baseURL }) => {
    const base = new URL(baseURL!)
    test.skip(base.hostname !== 'localhost', 'subdomains need a localhost base URL')

    await page.goto(`${base.protocol}//${SEED_USERNAME}.localhost:${base.port}/`)
    await expect(page.getByRole('link', { name: new RegExp(SEED.bookingLinkName) })).toBeVisible()
  })
})

// The seed user's username comes from the part of the email before the @.
const SEED_USERNAME = 'e2e'

async function bookSlot(page: Page, slotIndex: number) {
  {

    // The link resolved (not the "Page Not Found" error state): the link name
    // and duration render in the header.
    await expect(page.getByText(SEED.bookingLinkName)).toBeVisible()
    await expect(page.getByText(/30 min/i)).toBeVisible()

    // Pick a selectable day that is NOT today. Taking the first selectable day
    // meant always taking today, whose slot count shrinks with the wall clock:
    // the seeded window is 09:00–17:00 local, so by late afternoon only one or
    // two 30-minute slots remain and after 16:30 there are none at all. Each
    // successful run also books one of those remaining slots, so parallel
    // workers starved each other. The result was a test that failed by time of
    // day rather than by regression. Any future day still has the full window.
    const todayLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    }).format(new Date())

    const futureDay = `button[aria-label*=", 20"]:not([disabled]):not([aria-label="${todayLabel}"])`
    let dayButton = page.locator(futureDay).first()

    // If today is the last day of the month there is no future day in this
    // grid — roll forward and take the first selectable day of the next month.
    if ((await page.locator(futureDay).count()) === 0) {
      await page.getByRole('button', { name: 'Next month' }).click()
      dayButton = page.locator(futureDay).first()
    }

    await dayButton.waitFor({ state: 'visible' })
    await dayButton.click()

    // Slots load asynchronously; pick the first time-slot button (e.g. "9:00 AM").
    const slotButton = page.getByRole('button', { name: /^\d{1,2}:\d{2}(\s?[AP]M)?$/i }).nth(slotIndex)
    await slotButton.waitFor({ state: 'visible' })
    await slotButton.click()

    // The details form appears.
    await expect(page.getByText('Your details')).toBeVisible()
    await page.getByLabel('Your name').fill('E2E Booker')
    await page.getByLabel('Email address').fill('e2e-booker@example.com')
    await page.getByRole('button', { name: /confirm booking/i }).click()

    // Confirmation screen (auto-approve link → immediately confirmed).
    await expect(page.getByRole('heading', { name: /booking confirmed/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /add to google calendar/i })).toBeVisible()
  }
}
