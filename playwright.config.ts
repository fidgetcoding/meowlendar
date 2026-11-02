import { defineConfig, devices } from '@playwright/test'
import { SILENT_LAUNCH } from './e2e/silent-browser'

// E2E targets an external stack when E2E_BASE is set (CI / live Supabase);
// otherwise Playwright boots the web app itself on a dedicated port. The
// DB-dependent specs skip themselves when E2E_BASE is unset, so `--list` and the
// smoke test work without a backend.
const E2E_BASE = process.env.E2E_BASE
const PORT = 3999

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: E2E_BASE || `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    headless: true,
    launchOptions: SILENT_LAUNCH,
    // Pin timezone + locale so seeded times/dates render deterministically
    // regardless of the host machine's settings.
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  projects: [
    // Public pages, no session (login renders, redirects, etc.)
    {
      name: 'public',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Signs in via the real login form (auth.setup) and seeds baseline data
    // (seed.setup) before the authed project runs.
    { name: 'setup', testMatch: /\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Authenticated app flows reuse the saved session.
    {
      name: 'chromium',
      testIgnore: [/smoke\.spec\.ts/, /\.setup\.ts/],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
    },
  ],
  webServer: E2E_BASE
    ? undefined
    : {
        command: `pnpm --filter @poolendar/web dev --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
