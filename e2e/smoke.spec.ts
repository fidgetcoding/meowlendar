import { test, expect } from './test'

// The only spec that runs without a backend — the login page is a static client
// page (no DB). It's the fast gate that the app boots and renders at all.
test.describe('smoke', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: /meow/i })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /continue with google/i })
    ).toBeVisible()
    await expect(page.getByText(/purrrfect calendar/i)).toBeVisible()
  })
})
