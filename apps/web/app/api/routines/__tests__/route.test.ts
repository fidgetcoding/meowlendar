import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET, POST } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

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
import { omit } from '@/lib/omit'

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'

function createRequest(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    ...(body ? {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    } : {}),
  })
}

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'containedBy',
    'order', 'limit', 'range', 'filter', 'not', 'or', 'match',
  ]
  for (const m of methods) {
    builder[m] = vi.fn().mockReturnValue(builder)
  }
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    return Promise.resolve(result).then(resolve, reject)
  }
  return builder
}

function mockAuth(result: { data: unknown; error: unknown }) {
  const supabase = {
    from: vi.fn().mockReturnValue(makeQueryBuilder(result)),
  }
  vi.mocked(authenticate).mockResolvedValue({ userId: TEST_USER_ID, supabase: supabase as unknown as AuthResult['supabase'] })
  return supabase
}

function validRoutineBody() {
  return {
    title: 'Morning workout',
    start_time: '06:00',
    end_time: '07:00',
    timezone: 'America/New_York',
    recurrence_rule: 'FREQ=DAILY;BYDAY=MO,WE,FR',
  }
}

// ── GET Tests ──────────────────────────────────────────────────────────────

describe('GET /api/routines', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns routines list', async () => {
    const routines = [
      { id: 'r1', title: 'Morning workout', recurrence_rule: 'FREQ=DAILY' },
      { id: 'r2', title: 'Weekly review', recurrence_rule: 'FREQ=WEEKLY' },
    ]
    mockAuth({ data: routines, error: null })

    const req = createRequest('GET', '/api/routines')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].title).toBe('Morning workout')
    expect(body.next_cursor).toBeNull()
  })

  it('returns empty array when no routines exist', async () => {
    mockAuth({ data: [], error: null })

    const req = createRequest('GET', '/api/routines')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
  })

  it('returns 500 when supabase query fails', async () => {
    mockAuth({ data: null, error: { message: 'DB error' } })

    const req = createRequest('GET', '/api/routines')
    const res = await GET(req)

    expect(res.status).toBe(500)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const req = createRequest('GET', '/api/routines')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })
})

// ── POST Tests ─────────────────────────────────────────────────────────────

describe('POST /api/routines', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates routine with recurrence_rule and returns 201', async () => {
    const created = { id: 'r-new', ...validRoutineBody(), user_id: TEST_USER_ID }
    mockAuth({ data: created, error: null })

    const req = createRequest('POST', '/api/routines', validRoutineBody())
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.title).toBe('Morning workout')
    expect(body.recurrence_rule).toBe('FREQ=DAILY;BYDAY=MO,WE,FR')
  })

  it('rejects missing recurrence_rule with 400', async () => {
    mockAuth({ data: null, error: null })

    const noRule = omit(validRoutineBody(), ['recurrence_rule'])
    const req = createRequest('POST', '/api/routines', noRule)
    const res = await POST(req)

    expect(res.status).toBe(422)
  })

  it('rejects missing title with 400', async () => {
    mockAuth({ data: null, error: null })

    const noTitle = omit(validRoutineBody(), ['title'])
    const req = createRequest('POST', '/api/routines', noTitle)
    const res = await POST(req)

    expect(res.status).toBe(422)
  })

  it('rejects invalid time format with 400', async () => {
    mockAuth({ data: null, error: null })

    const req = createRequest('POST', '/api/routines', {
      ...validRoutineBody(),
      start_time: '6am',
      end_time: '7:00 AM',
    })
    const res = await POST(req)

    expect(res.status).toBe(422)
  })

  it('rejects invalid JSON body with 400', async () => {
    mockAuth({ data: null, error: null })

    const req = new NextRequest(new URL('/api/routines', 'http://localhost:3000'), {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 500 when supabase insert fails', async () => {
    mockAuth({ data: null, error: { message: 'insert failed' } })

    const req = createRequest('POST', '/api/routines', validRoutineBody())
    const res = await POST(req)

    expect(res.status).toBe(500)
  })
})
