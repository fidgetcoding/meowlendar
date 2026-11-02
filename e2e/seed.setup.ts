import { test as setup } from './test'
import { seedBaseline } from './seed'

// Runs in the `setup` project (alongside auth.setup.ts) before the authed
// chromium project. Populates the fixed baseline the DB-dependent specs read.
// Only runs against a live stack; the DB-dependent specs skip without E2E_BASE.
const E2E_LIVE = !!process.env.E2E_BASE

setup('seed baseline data', async () => {
  setup.skip(!E2E_LIVE, 'requires a live Supabase stack (set E2E_BASE)')
  await seedBaseline()
})
