import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/google/task-sync', () => ({
  flushTaskSync: vi.fn().mockResolvedValue({ pushed: 0, removed: 0, failed: 0 }),
}))
vi.mock('@/lib/google/webhooks', () => ({ registerAccountWebhook: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ pruneRateLimitEntries: vi.fn() }))
vi.mock('@/lib/google/sync', () => ({
  flushEventTombstones: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
  pullChanges: vi.fn().mockResolvedValue({ created: 0, updated: 0, deleted: 0 }),
  retryPendingPushEvents: vi
    .fn()
    .mockResolvedValue({ retried: 0, succeeded: 0, failed: 0, gaveUp: 0 }),
}))

vi.mock('@/lib/env', () => ({ requireEnv: vi.fn(() => 'x') }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  })),
}))

import { GET } from '../route'
import { retryPendingPushEvents } from '@/lib/google/sync'

const CRON_SECRET = 'cron-secret-value'

function cronRequest(auth?: string): NextRequest {
  return new NextRequest(new URL('/api/cron/sync-poll', 'http://localhost:3000'), {
    method: 'GET',
    ...(auth ? { headers: { authorization: auth } } : {}),
  })
}

describe('GET /api/cron/sync-poll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
  })

  it('rejects a request with no Authorization header', async () => {
    const res = await GET(cronRequest())
    expect(res.status).toBe(401)
    expect(retryPendingPushEvents).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong bearer token', async () => {
    const res = await GET(cronRequest('Bearer not-the-secret'))
    expect(res.status).toBe(401)
    expect(retryPendingPushEvents).not.toHaveBeenCalled()
  })

  it('runs the poll + retry pass with the correct CRON_SECRET', async () => {
    const res = await GET(cronRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(retryPendingPushEvents).toHaveBeenCalledTimes(1)
    expect(body.retry).toEqual({ retried: 0, succeeded: 0, failed: 0, gaveUp: 0 })
  })
})
