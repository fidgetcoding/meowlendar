import { defineConfig } from 'vitest/config'

// These run against a real local Supabase stack and a running app, in order,
// because they share one database and one set of fake servers.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
