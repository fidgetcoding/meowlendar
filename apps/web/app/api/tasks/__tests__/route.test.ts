import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
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
const TEST_TAG_ID = '00000000-0000-4000-8000-000000000003'

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

type SupabaseMockWithRpc = ReturnType<typeof mockAuthWithTables> & { rpc?: Mock }

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

describe('GET /api/tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns tasks list with tags joined', async () => {
    const tasks = [
      { id: 't1', title: 'Buy groceries', status: 'backlog' },
      { id: 't2', title: 'Write tests', status: 'in_progress' },
    ]
    const taskTags = [
      { task_id: 't1', tag_id: TEST_TAG_ID, tags: { id: TEST_TAG_ID, name: 'errands', color: '#ff0000', prefix: null } },
    ]

    mockAuthWithTables({
      tasks: { data: tasks, error: null },
      task_tags: { data: taskTags, error: null },
    })

    const req = createRequest('GET', '/api/tasks')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].tags).toHaveLength(1)
    expect(body.items[0].tags[0].name).toBe('errands')
    expect(body.items[1].tags).toHaveLength(0)
    expect(body.next_cursor).toBeNull()
  })

  it('filters tasks by status query param', async () => {
    const tasks = [{ id: 't1', title: 'In progress task', status: 'in_progress' }]
    const supabase = mockAuthWithTables({
      tasks: { data: tasks, error: null },
      task_tags: { data: [], error: null },
    })

    const req = createRequest('GET', '/api/tasks?status=in_progress')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(1)
    expect(supabase.from).toHaveBeenCalledWith('tasks')
  })

  it('filters tasks by board query param', async () => {
    const tasks = [{ id: 't1', title: 'Future task', board: 'future' }]
    mockAuthWithTables({
      tasks: { data: tasks, error: null },
      task_tags: { data: [], error: null },
    })

    const req = createRequest('GET', '/api/tasks?board=future')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(1)
  })

  it('returns empty array when no tasks exist', async () => {
    mockAuthWithTables({
      tasks: { data: [], error: null },
    })

    const req = createRequest('GET', '/api/tasks')
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toEqual([])
    expect(body.next_cursor).toBeNull()
  })

  it('returns 500 when supabase query fails', async () => {
    mockAuthWithTables({
      tasks: { data: null, error: { message: 'DB error' } },
    })

    const req = createRequest('GET', '/api/tasks')
    const res = await GET(req)

    expect(res.status).toBe(500)
  })
})

// ── POST Tests ─────────────────────────────────────────────────────────────

describe('POST /api/tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates task with title only (minimal) and returns 201', async () => {
    const createdTask = {
      id: 't-new',
      title: 'Quick task',
      status: 'backlog',
      board: 'current',
      importance: 'normal',
      user_id: TEST_USER_ID,
    }

    // The task + tags + subtasks are written atomically by the
    // create_task_with_children RPC, which returns the assembled task.
    const supabase: SupabaseMockWithRpc = mockAuthWithTables({})
    supabase.rpc = vi
      .fn()
      .mockResolvedValue({ data: { ...createdTask, tags: [], subtasks: [] }, error: null })

    const req = createRequest('POST', '/api/tasks', { title: 'Quick task' })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(supabase.rpc).toHaveBeenCalledWith('create_task_with_children', expect.any(Object))
    expect(body.title).toBe('Quick task')
    expect(body.tags).toEqual([])
    expect(body.subtasks).toEqual([])
  })

  it('creates task with scheduled_start/end for calendar display', async () => {
    const scheduledStart = '2026-06-16T14:00:00Z'
    const scheduledEnd = '2026-06-16T15:00:00Z'
    const createdTask = {
      id: 't-sched',
      title: 'Calendar task',
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      status: 'backlog',
      user_id: TEST_USER_ID,
    }

    const supabase: SupabaseMockWithRpc = mockAuthWithTables({})
    supabase.rpc = vi
      .fn()
      .mockResolvedValue({ data: { ...createdTask, tags: [], subtasks: [] }, error: null })

    const req = createRequest('POST', '/api/tasks', {
      title: 'Calendar task',
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.scheduled_start).toBe(scheduledStart)
    expect(body.scheduled_end).toBe(scheduledEnd)
  })

  it('creates task with all fields populated', async () => {
    const fullInput = {
      title: 'Full task',
      notes: 'Some notes',
      importance: 'high' as const,
      time_estimate_minutes: 60,
      earliest_start: '2026-06-14',
      due_date: '2026-06-20',
      scheduled_start: '2026-06-16T14:00:00Z',
      scheduled_end: '2026-06-16T15:00:00Z',
      location: 'Office',
      visibility: 'busy' as const,
      privacy: 'private' as const,
      flexibility: 'not_flexible' as const,
      status: 'in_progress' as const,
      board: 'current' as const,
      tag_ids: [TEST_TAG_ID],
      reminders: [{ minutes_before: 15 }],
      subtasks: [{ title: 'Subtask 1' }],
    }

    const createdTask = { id: 't-full', title: 'Full task', user_id: TEST_USER_ID }

    // `.from('tags')` still runs the cross-tenant ownership pre-check; the RPC
    // then does the atomic insert and returns the assembled task with tags + subtasks.
    const supabase: SupabaseMockWithRpc = mockAuthWithTables({
      tags: { data: [{ id: TEST_TAG_ID }], error: null }, // ownership check: tag belongs to caller
    })
    supabase.rpc = vi.fn().mockResolvedValue({
      data: {
        ...createdTask,
        tags: [{ id: TEST_TAG_ID, name: 'work', color: '#0000ff', prefix: null }],
        subtasks: [{ id: 'st-1', title: 'Subtask 1', completed: false, position: 1 }],
      },
      error: null,
    })

    const req = createRequest('POST', '/api/tasks', fullInput)
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.title).toBe('Full task')
    expect(body.tags).toHaveLength(1)
    expect(body.subtasks).toHaveLength(1)
  })

  it('rejects empty title with 422', async () => {
    mockAuthWithTables({})

    const req = createRequest('POST', '/api/tasks', { title: '' })
    const res = await POST(req)

    expect(res.status).toBe(422)
  })

  it('rejects tag_ids not owned by the caller with 400 (cross-tenant guard)', async () => {
    const FOREIGN_TAG = '00000000-0000-4000-8000-0000000000ff'
    const supabase = mockAuthWithTables({
      // Ownership lookup returns no rows — the tag is not the caller's.
      tags: { data: [], error: null },
      tasks: { data: { id: 't-x', title: 'x', user_id: TEST_USER_ID }, error: null },
    })

    const req = createRequest('POST', '/api/tasks', { title: 'x', tag_ids: [FOREIGN_TAG] })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.invalid_tag_ids).toEqual([FOREIGN_TAG])
    // The task must NOT have been inserted when tag ownership fails.
    expect(supabase.from).not.toHaveBeenCalledWith('tasks')
  })

  it('rejects missing title with 422', async () => {
    mockAuthWithTables({})

    const req = createRequest('POST', '/api/tasks', { notes: 'no title here' })
    const res = await POST(req)

    expect(res.status).toBe(422)
  })

  it('rejects invalid JSON body with 400', async () => {
    mockAuthWithTables({})

    const req = new NextRequest(new URL('/api/tasks', 'http://localhost:3000'), {
      method: 'POST',
      body: '{{invalid',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })

  it('rejects unauthenticated request with 401', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const req = createRequest('POST', '/api/tasks', { title: 'Should fail' })
    const res = await POST(req)

    expect(res.status).toBe(401)
  })
})

// ── vault_ref (the 2ndBrain link) ─────────────────────────────────────────

describe('vault_ref on the tasks collection', () => {
  beforeEach(() => vi.clearAllMocks())

  function mockRpc(result: { data: unknown; error: unknown }) {
    const supabase: SupabaseMockWithRpc = mockAuthWithTables({})
    supabase.rpc = vi.fn().mockResolvedValue(result)
    return supabase
  }

  const created = { data: { id: 't-new', title: 'Linked', vault_ref: 'work:mw-1a2b3c4d' }, error: null }

  it('passes vault_ref to the create RPC and returns it', async () => {
    const supabase = mockRpc(created)
    const res = await POST(createRequest('POST', '/api/tasks', { title: 'Linked', vault_ref: 'work:mw-1a2b3c4d' }))
    expect(res.status).toBe(201)
    expect((await res.json()).vault_ref).toBe('work:mw-1a2b3c4d')
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_task_with_children',
      expect.objectContaining({ p_task: expect.objectContaining({ vault_ref: 'work:mw-1a2b3c4d' }) }),
    )
  })

  it('passes a completed_at to the create RPC', async () => {
    const supabase = mockRpc(created)
    await POST(
      createRequest('POST', '/api/tasks', { title: 'Done', status: 'done', completed_at: '2026-04-16T12:00:00.000Z' }),
    )
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_task_with_children',
      expect.objectContaining({ p_task: expect.objectContaining({ completed_at: '2026-04-16T12:00:00.000Z' }) }),
    )
  })

  it('accepts null and leaves vault_ref out when it is not sent', async () => {
    const supabase = mockRpc(created)
    expect((await POST(createRequest('POST', '/api/tasks', { title: 'A', vault_ref: null }))).status).toBe(201)
    await POST(createRequest('POST', '/api/tasks', { title: 'B' }))
    const second = supabase.rpc?.mock.calls[1]?.[1] as { p_task: Record<string, unknown> }
    expect(second.p_task).not.toHaveProperty('vault_ref')
  })

  it.each(['has space', 'emoji\u{1F194}', '../x', 'x'.repeat(129), ''])('rejects the vault_ref %j with 422', async (ref) => {
    const supabase = mockRpc(created)
    const res = await POST(createRequest('POST', '/api/tasks', { title: 'A', vault_ref: ref }))
    expect(res.status).toBe(422)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('answers 409 when another task already holds the vault_ref', async () => {
    mockRpc({ data: null, error: { code: '23505', message: 'duplicate key' } })
    const res = await POST(createRequest('POST', '/api/tasks', { title: 'A', vault_ref: 'work:dup' }))
    expect(res.status).toBe(409)
  })

  it('still answers 500 for any other RPC failure', async () => {
    mockRpc({ data: null, error: { code: '42501', message: 'nope' } })
    const res = await POST(createRequest('POST', '/api/tasks', { title: 'A' }))
    expect(res.status).toBe(500)
  })

  it('returns vault_ref on list reads', async () => {
    mockAuthWithTables({
      tasks: { data: [{ id: 't1', title: 'A', vault_ref: 'work:abc' }], error: null },
      task_tags: { data: [], error: null },
    })
    const body = await (await GET(createRequest('GET', '/api/tasks'))).json()
    expect(body.items[0].vault_ref).toBe('work:abc')
  })
})

describe('migration 030', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../../../supabase/migrations/030_task_vault_ref.sql'), 'utf8')
  const original = readFileSync(resolve(__dirname, '../../../../../../supabase/migrations/013_task_write_rpcs.sql'), 'utf8')

  function createFunctionBody(text: string): string {
    const start = text.indexOf('create or replace function public.create_task_with_children')
    return text.slice(start, text.indexOf('$$;', start))
  }

  it('adds the column and a partial unique index', () => {
    expect(sql).toMatch(/add column if not exists vault_ref text/)
    expect(sql).toMatch(/on public\.tasks \(user_id, vault_ref\)\s+where vault_ref is not null/)
  })

  it('makes the create RPC keep vault_ref and a supplied completed_at', () => {
    const body = createFunctionBody(sql)
    expect(body).toMatch(/completed_at,\s+vault_ref\s+\) values/)
    expect(body).toContain("p_task->>'vault_ref'")
    expect(body).toContain("coalesce((p_task->>'completed_at')::timestamptz, now())")
  })

  it('changes nothing else in the RPC', () => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ')
    const before = normalize(createFunctionBody(original))
    const after = normalize(createFunctionBody(sql))
      .replace("completed_at, vault_ref ) values", 'completed_at ) values')
      .replace("case when v_status = 'done' then coalesce((p_task->>'completed_at')::timestamptz, now()) else null end, p_task->>'vault_ref' )", "case when v_status = 'done' then now() else null end )")
    expect(after).toBe(before)
  })
})
