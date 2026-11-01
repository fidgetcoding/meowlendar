import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
  validationError: vi.fn((issues: { path: (string | number)[]; message: string }[]) => {
    const details: Record<string, string[]> = {}
    for (const issue of issues) {
      const key = issue.path.join('.') || '_root'
      if (!details[key]) details[key] = []
      details[key]!.push(issue.message)
    }
    return NextResponse.json({ error: 'Validation error', details }, { status: 422 })
  }),
}))

import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'

function createRequest(body?: unknown): NextRequest {
  return new NextRequest(new URL('/api/tasks/reflow', 'http://localhost:3000'), {
    method: 'POST',
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  })
}

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const methods = ['select', 'update', 'eq', 'gte', 'lte', 'not', 'order', 'is']
  for (const m of methods) builder[m] = vi.fn().mockReturnValue(builder)
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockAuthWithTasks(results: { data: unknown; error: unknown }[]) {
  let call = 0
  const supabase = {
    from: vi.fn().mockImplementation(() => makeQueryBuilder(results[call++] ?? results[results.length - 1]!)),
  }
  vi.mocked(authenticate).mockResolvedValue({ userId: TEST_USER_ID, supabase: supabase as unknown as AuthResult['supabase'] })
  return supabase
}

describe('POST /api/tasks/reflow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('repacks overlapping flexible tasks on the day, in order', async () => {
    // t1 14:00–15:00, t2 14:30–15:30 (overlaps). Both flexible, both on 2026-06-15 NY.
    const nearby = [
      {
        id: 't1',
        scheduled_start: '2026-06-15T14:00:00-04:00',
        scheduled_end: '2026-06-15T15:00:00-04:00',
        flexibility: 'flexible',
        is_split: false,
      },
      {
        id: 't2',
        scheduled_start: '2026-06-15T14:30:00-04:00',
        scheduled_end: '2026-06-15T15:30:00-04:00',
        flexibility: 'flexible',
        is_split: false,
      },
    ]
    // 1st from(): select nearby. 2nd from(): the single update (only t2 moves).
    mockAuthWithTasks([
      { data: nearby, error: null },
      { data: null, error: null },
    ])

    const res = await POST(createRequest({ date: '2026-06-15', timezone: 'America/New_York' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.date).toBe('2026-06-15')
    expect(body.moved).toBe(1) // t1 stays; t2 is pushed to 15:00
    expect(body.tasks).toHaveLength(2)
    // t2 now starts where t1 ends (15:00-04:00 === 19:00Z).
    const t2 = body.tasks.find((t: { id: string }) => t.id === 't2')
    expect(new Date(t2.scheduled_start).toISOString()).toBe('2026-06-15T19:00:00.000Z')
  })

  it('does not move non-flexible tasks (moved = 0)', async () => {
    const nearby = [
      {
        id: 'fixed',
        scheduled_start: '2026-06-15T14:00:00-04:00',
        scheduled_end: '2026-06-15T15:00:00-04:00',
        flexibility: 'not_flexible',
        is_split: false,
      },
    ]
    mockAuthWithTasks([{ data: nearby, error: null }])

    const res = await POST(createRequest({ date: '2026-06-15' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.moved).toBe(0)
  })

  it('rejects a malformed date with 422', async () => {
    mockAuthWithTasks([{ data: [], error: null }])
    const res = await POST(createRequest({ date: 'not-a-date' }))
    expect(res.status).toBe(422)
  })

  it('rejects invalid JSON with 400', async () => {
    mockAuthWithTasks([{ data: [], error: null }])
    const req = new NextRequest(new URL('/api/tasks/reflow', 'http://localhost:3000'), {
      method: 'POST',
      body: '{{bad',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects unauthenticated with 401', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(createRequest({ date: '2026-06-15' }))
    expect(res.status).toBe(401)
  })
})
