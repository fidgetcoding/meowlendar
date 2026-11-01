import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET, PATCH, DELETE } from '../route'

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

describe('GET /api/tasks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns single task by ID with subtasks, children, and tags', async () => {
    const task = { id: TEST_TASK_ID, title: 'Main task', status: 'backlog', user_id: TEST_USER_ID }
    const subtasks = [
      { id: 'st-1', task_id: TEST_TASK_ID, title: 'Step 1', completed: false, position: 1 },
      { id: 'st-2', task_id: TEST_TASK_ID, title: 'Step 2', completed: true, position: 2 },
    ]
    const children = [{ id: 'child-1', title: 'Child task', parent_id: TEST_TASK_ID }]
    const tags = [
      { tag_id: 'tag-1', tags: { id: 'tag-1', name: 'dev', color: '#00ff00', prefix: null } },
    ]

    // GET: from('tasks').single() for main task, then Promise.all:
    //   from('subtasks'), from('tasks') for children, from('task_tags')
    mockAuthWithTables({
      tasks: [
        { data: task, error: null },     // initial fetch
        { data: children, error: null }, // children query (bare await)
      ],
      subtasks: { data: subtasks, error: null },
      task_tags: { data: tags, error: null },
    })

    const req = createRequest('GET', `/api/tasks/${TEST_TASK_ID}`)
    const res = await GET(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.id).toBe(TEST_TASK_ID)
    expect(body.subtasks).toHaveLength(2)
    expect(body.children).toHaveLength(1)
    expect(body.tags).toHaveLength(1)
    expect(body.tags[0].name).toBe('dev')
  })

  it('returns 404 for non-existent task', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest('GET', '/api/tasks/nonexistent')
    const res = await GET(req, routeParams('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Task not found')
  })
})

// ── PATCH Tests ────────────────────────────────────────────────────────────

describe('PATCH /api/tasks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates task fields and returns updated task with tags', async () => {
    const existing = { id: TEST_TASK_ID, status: 'backlog', user_id: TEST_USER_ID }
    const updated = { ...existing, title: 'Updated title' }

    // PATCH: fetch existing (.single), update (.single), fetch tags (bare await)
    mockAuthWithTables({
      tasks: [
        { data: existing, error: null }, // verify ownership
        { data: updated, error: null },  // update
      ],
      task_tags: { data: [], error: null },
    })

    const req = createRequest('PATCH', `/api/tasks/${TEST_TASK_ID}`, { title: 'Updated title' })
    const res = await PATCH(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.title).toBe('Updated title')
    expect(body.tags).toEqual([])
  })

  it('sets completed_at when status changes to done', async () => {
    const existing = { id: TEST_TASK_ID, status: 'in_progress', user_id: TEST_USER_ID }
    const updated = { ...existing, status: 'done', completed_at: '2026-06-13T10:00:00.000Z' }

    mockAuthWithTables({
      tasks: [
        { data: existing, error: null },
        { data: updated, error: null },
      ],
      task_tags: { data: [], error: null },
    })

    const req = createRequest('PATCH', `/api/tasks/${TEST_TASK_ID}`, { status: 'done' })
    const res = await PATCH(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('done')
    expect(body.completed_at).toBeDefined()
  })

  it('clears completed_at when status changes away from done', async () => {
    const existing = { id: TEST_TASK_ID, status: 'done', user_id: TEST_USER_ID }
    const updated = { ...existing, status: 'in_progress', completed_at: null }

    mockAuthWithTables({
      tasks: [
        { data: existing, error: null },
        { data: updated, error: null },
      ],
      task_tags: { data: [], error: null },
    })

    const req = createRequest('PATCH', `/api/tasks/${TEST_TASK_ID}`, { status: 'in_progress' })
    const res = await PATCH(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.completed_at).toBeNull()
  })

  it('returns 404 when task does not exist', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: { code: 'PGRST116' } },
    })

    const req = createRequest('PATCH', `/api/tasks/${TEST_TASK_ID}`, { title: 'nope' })
    const res = await PATCH(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Task not found')
  })

  it('returns 400 for invalid JSON body', async () => {
    mockAuthWithTables({})

    const req = new NextRequest(new URL(`/api/tasks/${TEST_TASK_ID}`, 'http://localhost:3000'), {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })

  it('rejects tag_ids not owned by the caller with 400 (cross-tenant guard)', async () => {
    const FOREIGN_TAG = '00000000-0000-4000-8000-0000000000ff'
    mockAuthWithTables({
      tasks: { data: { id: TEST_TASK_ID, status: 'backlog', user_id: TEST_USER_ID }, error: null },
      // Ownership lookup returns no rows — the tag is not the caller's.
      tags: { data: [], error: null },
    })

    const req = createRequest('PATCH', `/api/tasks/${TEST_TASK_ID}`, { tag_ids: [FOREIGN_TAG] })
    const res = await PATCH(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.invalid_tag_ids).toEqual([FOREIGN_TAG])
  })
})

// ── DELETE Tests ───────────────────────────────────────────────────────────

describe('DELETE /api/tasks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes task and returns 204', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: null },
    })

    const req = createRequest('DELETE', `/api/tasks/${TEST_TASK_ID}`)
    const res = await DELETE(req, routeParams(TEST_TASK_ID))

    expect(res.status).toBe(204)
  })

  it('returns 500 when delete fails', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: { message: 'FK violation' } },
    })

    const req = createRequest('DELETE', `/api/tasks/${TEST_TASK_ID}`)
    const res = await DELETE(req, routeParams(TEST_TASK_ID))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('Failed to delete task')
  })
})

// ── vault_ref and completed_at (the 2ndBrain link) ────────────────────────

describe('PATCH /api/tasks/:id for the vault sync', () => {
  beforeEach(() => vi.clearAllMocks())

  /** Runs a PATCH against a task in `status` and returns what was written to the row. */
  async function patch(status: string, body: unknown, updateError: unknown = null) {
    const existing = { id: TEST_TASK_ID, status, user_id: TEST_USER_ID }
    const supabase = mockAuthWithTables({
      tasks: [
        { data: existing, error: null },
        { data: updateError ? null : { ...existing, vault_ref: 'work:abc' }, error: updateError },
      ],
      task_tags: { data: [], error: null },
    })
    const res = await PATCH(createRequest('PATCH', `/api/tasks/${TEST_TASK_ID}`, body), routeParams(TEST_TASK_ID))
    const builder = supabase.from.mock.results[1]?.value as { update?: ReturnType<typeof vi.fn> } | undefined
    return { res, written: builder?.update?.mock.calls[0]?.[0] as Record<string, unknown> | undefined }
  }

  it('sets vault_ref and returns it', async () => {
    const { res, written } = await patch('backlog', { vault_ref: 'work:abc' })
    expect(res.status).toBe(200)
    expect(written).toEqual({ vault_ref: 'work:abc' })
    expect((await res.json()).vault_ref).toBe('work:abc')
  })

  it('clears vault_ref with null', async () => {
    const { res, written } = await patch('backlog', { vault_ref: null })
    expect(res.status).toBe(200)
    expect(written).toEqual({ vault_ref: null })
  })

  it.each(['has space', '../x', 'x'.repeat(129)])('rejects the vault_ref %j with 422', async (ref) => {
    const { res, written } = await patch('backlog', { vault_ref: ref })
    expect(res.status).toBe(422)
    expect(written).toBeUndefined()
  })

  it('answers 409 when another task already holds the vault_ref', async () => {
    const { res } = await patch('backlog', { vault_ref: 'work:dup' }, { code: '23505' })
    expect(res.status).toBe(409)
  })

  it('uses a supplied completed_at when a task becomes done', async () => {
    const { written } = await patch('backlog', { status: 'done', completed_at: '2026-04-16T12:00:00.000Z' })
    expect(written).toEqual({ status: 'done', completed_at: '2026-04-16T12:00:00.000Z' })
  })

  it('falls back to now when a task becomes done with no date', async () => {
    const { written } = await patch('backlog', { status: 'done' })
    expect(typeof written?.completed_at).toBe('string')
    expect(Date.now() - Date.parse(written?.completed_at as string)).toBeLessThan(60_000)
  })

  it('moves the date of a task that is already done', async () => {
    const { written } = await patch('done', { completed_at: '2026-04-16T12:00:00.000Z' })
    expect(written).toEqual({ completed_at: '2026-04-16T12:00:00.000Z' })
  })

  it('never blanks the date of a task that stays done', async () => {
    const { written } = await patch('done', { completed_at: null, title: 'x' })
    expect(written).toEqual({ title: 'x' })
  })

  it('leaves the date of an already done task alone when none is sent', async () => {
    const { written } = await patch('done', { status: 'done' })
    expect(written).toEqual({ status: 'done' })
  })

  it('ignores a completed_at on a task that is not done', async () => {
    const { written } = await patch('backlog', { completed_at: '2026-04-16T12:00:00.000Z', title: 'x' })
    expect(written).toEqual({ title: 'x' })
  })

  it('clears the date when a task leaves done, even if one is sent', async () => {
    const { written } = await patch('done', { status: 'backlog', completed_at: '2026-04-16T12:00:00.000Z' })
    expect(written).toEqual({ status: 'backlog', completed_at: null })
  })

  it('returns vault_ref on a single read', async () => {
    mockAuthWithTables({
      tasks: [
        { data: { id: TEST_TASK_ID, title: 'A', vault_ref: 'work:abc' }, error: null },
        { data: [], error: null },
      ],
      subtasks: { data: [], error: null },
      task_tags: { data: [], error: null },
    })
    const res = await GET(createRequest('GET', `/api/tasks/${TEST_TASK_ID}`), routeParams(TEST_TASK_ID))
    expect((await res.json()).vault_ref).toBe('work:abc')
  })
})
