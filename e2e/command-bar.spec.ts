import { test, expect } from './test'
import { SEED } from './seed'

const E2E_LIVE = !!process.env.E2E_BASE

test.describe('command bar (#72a–c)', () => {
  // Compile the search route before the tests race it (the dev server builds routes on first hit).
  test.beforeAll(async ({ playwright }, info) => {
    if (!E2E_LIVE) return
    const api = await playwright.request.newContext({ baseURL: info.project.use.baseURL })
    await api.get('/api/search?q=warm', { timeout: 60_000 }).catch(() => {})
    await api.dispose()
  })

  test.beforeEach(async ({ page }) => {
    test.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')
    await page.goto('/')
  })

  test('⌘K opens the palette with the master prompt', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await expect(page.getByPlaceholder(/what do you need/i)).toBeVisible()
  })

  test('actions are grouped and dispatch — Open Kanban switches to board', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    // cmdk renders each section as an accessible group named by its heading.
    // (Targeting the group role avoids the heading/label text appearing twice.)
    await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Navigation' })).toBeVisible()

    await page.getByText('Open Kanban Board').click()
    await expect(page.getByText('Backlog', { exact: true })).toBeVisible()
  })

  test('Go to Today action closes the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await page.getByText('Go to Today').click()
    await expect(page.getByPlaceholder(/what do you need/i)).toBeHidden()
  })

  test('typing a query shows grouped search results', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    // Wait for the search itself, however long its route takes to compile under parallel load,
    // rather than a fixed timeout. The assertions below are unchanged.
    const searched = page.waitForResponse(
      (res) => res.url().includes('/api/search') && new URL(res.url()).searchParams.get('q') === 'meeting',
    )
    await page.getByPlaceholder(/what do you need/i).fill('meeting')
    const response = await searched
    expect(response.ok()).toBe(true)

    // The seeded "Weekly Meeting Sync" task surfaces under a Search Results group.
    await expect(page.getByRole('group', { name: /search results/i })).toBeVisible()
    await expect(page.getByText(SEED.searchTaskTitle)).toBeVisible()
  })
})
