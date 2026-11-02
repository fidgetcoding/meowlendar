import { test as setup, expect } from './test'

// Signs in through the real login form (email/password path, spec #91) and
// persists the session as storageState for the authed project. Runs only when
// E2E_BASE points at a live stack; the seed user is created by e2e/seed
// (or manually: e2e@poolendar.test / e2e-test-password-1 against the local stack).
const E2E_LIVE = !!process.env.E2E_BASE

const EMAIL = process.env.E2E_EMAIL || 'e2e@poolendar.test'
const PASSWORD = process.env.E2E_PASSWORD || 'e2e-test-password-1'

setup('authenticate', async ({ page }) => {
  setup.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')

  await page.goto('/login')
  await page.getByRole('textbox', { name: /email/i }).fill(EMAIL)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()

  // Landing on the app shell (not /login) proves the session cookie landed.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  })
  await expect(page.locator('body')).toBeVisible()

  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})
