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

// ── Helpers ────────────────────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const TEST_TASK_ID = '00000000-0000-4000-8000-000000000004'

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

// ── GET Tests ──────────────────────────────────────────────────────────────

describe('GET /api/tasks/:id/subtasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns subtasks ordered by position', async () => {
    const subtasks = [
      { id: 'st-1', task_id: TEST_TASK_ID, title: 'First', completed: false, position: 1.0 },
      { id: 'st-2', task_id: TEST_TASK_ID, title: 'Second', completed: true, position: 2.0 },
      { id: 'st-3', task_id: TEST_TASK_ID, title: 'Third', completed: false, position: 3.0 },
    ]

    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID }, error: null },
      subtasks: { data: subtasks, error: null },
    })

    const req = createRequest('GET', `/api/tasks/${TEST_TASK_ID}/subtasks`)
    const res = await GET(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveLength(3)
    expect(body[0].title).toBe('First')
    expect(body[2].title).toBe('Third')
  })

  it('returns empty array when task has no subtasks', async () => {
    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID }, error: null },
      subtasks: { data: [], error: null },
    })

    const req = createRequest('GET', `/api/tasks/${TEST_TASK_ID}/subtasks`)
    const res = await GET(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual([])
  })

  it('returns 404 when parent task does not exist', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest('GET', '/api/tasks/nonexistent/subtasks')
    const res = await GET(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Task not found')
  })
})

// ── POST Tests ─────────────────────────────────────────────────────────────

describe('POST /api/tasks/:id/subtasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates subtask with title and returns 201', async () => {
    const newSubtask = {
      id: 'st-new',
      task_id: TEST_TASK_ID,
      title: 'New subtask',
      time_estimate_minutes: null,
      completed: false,
      position: 1.0,
    }

    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID }, error: null },
      subtasks: [
        { data: null, error: null },          // max position query (no existing subtasks)
        { data: newSubtask, error: null },     // insert
      ],
    })

    const req = createRequest('POST', `/api/tasks/${TEST_TASK_ID}/subtasks`, { title: 'New subtask' })
    const res = await POST(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.title).toBe('New subtask')
    expect(body.completed).toBe(false)
  })

  it('creates subtask with time_estimate', async () => {
    const newSubtask = {
      id: 'st-timed',
      task_id: TEST_TASK_ID,
      title: 'Timed subtask',
      time_estimate_minutes: 30,
      completed: false,
      position: 2.0,
    }

    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID }, error: null },
      subtasks: [
        { data: { position: 1.0 }, error: null },   // max position
        { data: newSubtask, error: null },           // insert
      ],
    })

    const req = createRequest('POST', `/api/tasks/${TEST_TASK_ID}/subtasks`, {
      title: 'Timed subtask',
      time_estimate_minutes: 30,
    })
    const res = await POST(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.time_estimate_minutes).toBe(30)
    expect(body.position).toBe(2.0)
  })

  it('rejects empty title with 400', async () => {
    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID }, error: null },
    })

    const req = createRequest('POST', `/api/tasks/${TEST_TASK_ID}/subtasks`, { title: '' })
    const res = await POST(req, routeParams(TEST_TASK_ID))

    expect(res.status).toBe(422)
  })

  it('rejects invalid JSON with 400', async () => {
    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID }, error: null },
    })

    const req = new NextRequest(
      new URL(`/api/tasks/${TEST_TASK_ID}/subtasks`, 'http://localhost:3000'),
      {
        method: 'POST',
        body: 'broken{json',
        headers: { 'Content-Type': 'application/json' },
      }
    )
    const res = await POST(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 404 when parent task does not exist', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest('POST', '/api/tasks/nonexistent/subtasks', { title: 'Orphan' })
    const res = await POST(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Task not found')
  })
})
