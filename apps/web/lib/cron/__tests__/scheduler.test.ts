import { describe, it, expect, vi } from 'vitest'

vi.mock('../reminders', () => ({ runReminders: vi.fn() }))
vi.mock('../sync-job', () => ({ runSyncPoll: vi.fn(), runWebhookRenewal: vi.fn() }))

import { schedulerInterval } from '../scheduler'

const base = { NEXT_PUBLIC_SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' } as unknown as NodeJS.ProcessEnv

describe('schedulerInterval', () => {
  it('runs by default on a plain server', () => {
    expect(schedulerInterval(base)).toBe(300)
  })

  it('stays off on Vercel, which uses vercel.json crons', () => {
    expect(schedulerInterval({ ...base, VERCEL: '1' })).toBeNull()
  })

  it('stays off without a service key', () => {
    expect(schedulerInterval({ NEXT_PUBLIC_SUPABASE_URL: 'http://x' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  it('honours a custom interval, and 0 turns it off', () => {
    expect(schedulerInterval({ ...base, SCHEDULER_INTERVAL_SECONDS: '60' })).toBe(60)
    expect(schedulerInterval({ ...base, SCHEDULER_INTERVAL_SECONDS: '0' })).toBeNull()
    expect(schedulerInterval({ ...base, SCHEDULER_INTERVAL_SECONDS: 'nope' })).toBeNull()
  })
})
