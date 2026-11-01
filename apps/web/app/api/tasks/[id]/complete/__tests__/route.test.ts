import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../route'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_TASK_ID = '00000000-0000-4000-8000-000000000004'

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

function mockAuth(result: { data: unknown; error: unknown }) {
  const supabase = {
    from: vi.fn().mockReturnValue(makeQueryBuilder(result)),
  }
  vi.mocked(authenticate).mockResolvedValue({ userId: TEST_USER_ID, supabase: supabase as unknown as AuthResult['supabase'] })
  return supabase
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/tasks/:id/complete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks task as done and sets completed_at', async () => {
    const completedTask = {
      id: TEST_TASK_ID,
      title: 'Finish tests',
      status: 'done',
      completed_at: '2026-06-13T15:00:00.000Z',
      user_id: TEST_USER_ID,
    }

    mockAuth({ data: completedTask, error: null })

    const req = createRequest('POST', `/api/tasks/${TEST_TASK_ID}/complete`)
    const res = await POST(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('done')
    expect(body.completed_at).toBeDefined()
  })

  it('succeeds idempotently on already completed task', async () => {
    const alreadyDone = {
      id: TEST_TASK_ID,
      title: 'Already done',
      status: 'done',
      completed_at: '2026-06-12T10:00:00.000Z',
      user_id: TEST_USER_ID,
    }

    mockAuth({ data: alreadyDone, error: null })

    const req = createRequest('POST', `/api/tasks/${TEST_TASK_ID}/complete`)
    const res = await POST(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('done')
    expect(body.completed_at).toBeDefined()
  })

  it('returns 404 when task does not exist', async () => {
    mockAuth({ data: null, error: { code: 'PGRST116' } })

    const req = createRequest('POST', '/api/tasks/nonexistent/complete')
    const res = await POST(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Task not found')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const req = createRequest('POST', `/api/tasks/${TEST_TASK_ID}/complete`)
    const res = await POST(req, routeParams(TEST_TASK_ID))

    expect(res.status).toBe(401)
  })
})
