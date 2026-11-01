import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

vi.mock('rrule', () => {
  return {
    RRule: {
      fromString: vi.fn().mockReturnValue({
        between: vi.fn().mockReturnValue([
          new Date('2026-06-16T00:00:00Z'),
          new Date('2026-06-18T00:00:00Z'),
          new Date('2026-06-20T00:00:00Z'),
        ]),
      }),
    },
  }
})

import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_ROUTINE_ID = '00000000-0000-4000-8000-000000000005'

function createRequest(method: string, url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), { method })
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

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function mockAuthWithTables(
  tableResults: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>
) {
  const callCounts: Record<string, number> = {}
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (!callCounts[table]) callCounts[table] = 0
      const entry = tableResults[table]
      let result: { data: unknown; error: unknown }
      if (Array.isArray(entry)) {
        result = entry[callCounts[table]!] ?? entry[entry.length - 1]!
      } else {
        result = entry ?? { data: null, error: null }
      }
      callCounts[table]!++
      return makeQueryBuilder(result)
    }),
  }
  vi.mocked(authenticate).mockResolvedValue({ userId: TEST_USER_ID, supabase: supabase as unknown as AuthResult['supabase'] })
  return supabase
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/routines/:id/instances', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns instances for a routine merging existing and generated', async () => {
    const routine = {
      id: TEST_ROUTINE_ID,
      title: 'Workout',
      recurrence_rule: 'FREQ=DAILY;BYDAY=MO,WE,FR',
      user_id: TEST_USER_ID,
    }

    const existingInstances = [
      {
        id: 'inst-1',
        routine_id: TEST_ROUTINE_ID,
        date: '2026-06-16',
        status: 'completed',
        completed_at: '2026-06-16T07:00:00Z',
      },
    ]

    mockAuthWithTables({
      routines: { data: routine, error: null },
      routine_instances: { data: existingInstances, error: null },
    })

    const req = createRequest(
      'GET',
      `/api/routines/${TEST_ROUTINE_ID}/instances?start=2026-06-15&end=2026-06-21`
    )
    const res = await GET(req, routeParams(TEST_ROUTINE_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    // 1 existing + 2 generated (June 18, June 20 -- June 16 already has a row)
    expect(body).toHaveLength(3)

    // Existing instance retains its status
    const existing = body.find((i: { id: string | null }) => i.id === 'inst-1')
    expect(existing).toBeDefined()
    expect(existing.status).toBe('completed')

    // Generated instances have pending status and null id
    const generated = body.filter((i: { id: string | null }) => i.id === null)
    expect(generated).toHaveLength(2)
    expect(generated[0].status).toBe('pending')
  })

  it('returns empty array when no occurrences in range', async () => {
    const routine = {
      id: TEST_ROUTINE_ID,
      title: 'Workout',
      recurrence_rule: 'FREQ=DAILY;BYDAY=MO,WE,FR',
      user_id: TEST_USER_ID,
    }

    const { RRule } = await import('rrule')
    vi.mocked(RRule.fromString).mockReturnValueOnce({
      between: vi.fn().mockReturnValue([]),
    } as unknown as InstanceType<typeof RRule>)

    mockAuthWithTables({
      routines: { data: routine, error: null },
      routine_instances: { data: [], error: null },
    })

    const req = createRequest(
      'GET',
      `/api/routines/${TEST_ROUTINE_ID}/instances?start=2026-12-25&end=2026-12-25`
    )
    const res = await GET(req, routeParams(TEST_ROUTINE_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns 400 when start/end query params are missing', async () => {
    mockAuthWithTables({})

    const req = createRequest('GET', `/api/routines/${TEST_ROUTINE_ID}/instances`)
    const res = await GET(req, routeParams(TEST_ROUTINE_ID))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Missing required query parameters')
  })

  it('returns 400 for invalid date format', async () => {
    mockAuthWithTables({})

    const req = createRequest(
      'GET',
      `/api/routines/${TEST_ROUTINE_ID}/instances?start=not-a-date&end=also-bad`
    )
    const res = await GET(req, routeParams(TEST_ROUTINE_ID))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Invalid date format')
  })

  it('returns 404 when routine does not exist', async () => {
    mockAuthWithTables({
      routines: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest(
      'GET',
      '/api/routines/nonexistent/instances?start=2026-06-15&end=2026-06-21'
    )
    const res = await GET(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Routine not found')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const req = createRequest(
      'GET',
      `/api/routines/${TEST_ROUTINE_ID}/instances?start=2026-06-15&end=2026-06-21`
    )
    const res = await GET(req, routeParams(TEST_ROUTINE_ID))

    expect(res.status).toBe(401)
  })
})
