import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Chainable Supabase mock
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown }

function createChain(result: MockResult = { data: null, error: null }) {
  const chain: Record<string | symbol, unknown> = {}
  const methods = [
    'from', 'select', 'insert', 'update', 'delete',
    'eq', 'in', 'lt', 'gt', 'not', 'is', 'or', 'ilike',
    'order', 'limit', 'single', 'maybeSingle',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = (resolve: (v: MockResult) => void) => resolve(result)
  chain[Symbol.toStringTag] = 'Promise'
  chain.single = vi.fn().mockReturnValue({
    ...chain,
    then: (resolve: (v: MockResult) => void) => resolve(result),
  })
  chain.select = vi.fn().mockImplementation(() => chain)
  return chain
}

function createSupabaseMock() {
  let defaultResult: MockResult = { data: null, error: null }
  const tableResults = new Map<string, MockResult[]>()

  function setResult(table: string, result: MockResult) {
    const existing = tableResults.get(table) ?? []
    existing.push(result)
    tableResults.set(table, existing)
  }

  function build() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        const results = tableResults.get(table) ?? []
        const result = results.shift() ?? defaultResult
        return createChain(result)
      }),
    }
  }

  return { setResult, setDefault: (r: MockResult) => { defaultResult = r }, build }
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockAuthenticate = vi.fn()

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  isAuthError: (result: Partial<Response>) =>
    result instanceof Response ||
    (result && typeof result.status === 'number' && typeof result.json === 'function'),
  validationError: (issues: { path: (string | number)[]; message: string }[]) => {
    const details: Record<string, string[]> = {}
    for (const issue of issues) {
      const key = issue.path.join('.') || '_root'
      if (!details[key]) details[key] = []
      details[key].push(issue.message)
    }
    return Response.json({ error: 'Validation error', details }, { status: 422 })
  },
}))

vi.mock('@/lib/google/calendar', () => ({
  createGoogleEvent: vi.fn().mockResolvedValue({ id: 'gcal-1', etag: '"etag"', hangoutLink: null }),
  deleteGoogleEvent: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/convert', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const EVENT_SOURCE = {
  id: 'evt-1',
  user_id: 'user-123',
  title: 'Weekly standup',
  notes: 'Team sync',
  start_time: '2026-06-16T09:00:00Z',
  end_time: '2026-06-16T09:30:00Z',
  location: 'Room A',
  visibility: 'busy',
  privacy: 'public',
  reminders: [],
  timezone: 'America/New_York',
  google_event_id: null,
  calendar_id: null,
}

const TASK_SOURCE = {
  id: 'task-1',
  user_id: 'user-123',
  title: 'Write tests',
  notes: 'Integration tests',
  scheduled_start: '2026-06-16T10:00:00Z',
  scheduled_end: '2026-06-16T11:00:00Z',
  time_estimate_minutes: 60,
  location: null,
  visibility: 'busy',
  privacy: 'private',
  reminders: [],
}

const ROUTINE_SOURCE = {
  id: 'routine-1',
  user_id: 'user-123',
  title: 'Morning standup',
  notes: 'Daily sync',
  start_time: '09:00',
  end_time: '09:30',
  timezone: 'America/New_York',
  recurrence_rule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  location: null,
  visibility: 'busy',
  privacy: 'public',
  reminders: [],
}

const UUID = '00000000-0000-4000-8000-000000000001'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/convert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { POST } = await import('../route')
    const res = await POST(makeRequest({
      source_type: 'event',
      source_id: UUID,
      target_type: 'task',
    }))

    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON body', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const req = new NextRequest('http://localhost/api/convert', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 when source_type equals target_type', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest({
      source_type: 'event',
      source_id: UUID,
      target_type: 'event',
    }))

    expect(res.status).toBe(422)
  })

  it('returns 400 for invalid source_type', async () => {
    const factory = createSupabaseMock()
    mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

    const { POST } = await import('../route')
    const res = await POST(makeRequest({
      source_type: 'booking',
      source_id: UUID,
      target_type: 'task',
    }))

    expect(res.status).toBe(422)
  })

  // -----------------------------------------------------------------------
  // Event -> Task
  // -----------------------------------------------------------------------
  describe('event -> task', () => {
    it('converts event to task successfully', async () => {
      const factory = createSupabaseMock()
      // Fetch source event
      factory.setResult('events', { data: EVENT_SOURCE, error: null })
      // Insert task
      factory.setResult('tasks', { data: { ...TASK_SOURCE, id: 'new-task-1' }, error: null })
      // Delete source event
      factory.setResult('events', { data: null, error: null })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'event',
        source_id: UUID,
        target_type: 'task',
      }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.type).toBe('task')
      expect(json.data).toBeDefined()
    })

    it('returns 404 when source event does not exist', async () => {
      const factory = createSupabaseMock()
      factory.setResult('events', { data: null, error: { code: 'PGRST116' } })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'event',
        source_id: UUID,
        target_type: 'task',
      }))

      expect(res.status).toBe(404)
    })
  })

  // -----------------------------------------------------------------------
  // Task -> Event
  // -----------------------------------------------------------------------
  describe('task -> event', () => {
    it('converts task to event with calendar_id', async () => {
      const factory = createSupabaseMock()
      // Fetch source task
      factory.setResult('tasks', { data: TASK_SOURCE, error: null })
      // Fetch calendar
      factory.setResult('calendars', {
        data: { id: 'cal-1', google_account_id: 'ga-1', google_calendar_id: 'gc-1' },
        error: null,
      })
      // Insert event
      factory.setResult('events', {
        data: { id: 'new-evt-1', title: 'Write tests' },
        error: null,
      })
      // Google sync update
      factory.setResult('events', { data: null, error: null })
      // Delete source task
      factory.setResult('tasks', { data: null, error: null })
      // Final fetch of event
      factory.setResult('events', {
        data: { id: 'new-evt-1', title: 'Write tests', google_event_id: 'gcal-1' },
        error: null,
      })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'task',
        source_id: UUID,
        target_type: 'event',
        calendar_id: UUID,
      }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.type).toBe('event')
    })

    it('returns 400 when calendar_id missing for task -> event', async () => {
      const factory = createSupabaseMock()
      factory.setResult('tasks', { data: TASK_SOURCE, error: null })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'task',
        source_id: UUID,
        target_type: 'event',
      }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('calendar_id')
    })
  })

  // -----------------------------------------------------------------------
  // Task -> Routine
  // -----------------------------------------------------------------------
  describe('task -> routine', () => {
    it('converts task to routine with repeat_pattern', async () => {
      const factory = createSupabaseMock()
      factory.setResult('tasks', { data: TASK_SOURCE, error: null })
      factory.setResult('routines', {
        data: { id: 'new-routine-1', title: 'Write tests', recurrence_rule: 'RRULE:FREQ=WEEKLY' },
        error: null,
      })
      factory.setResult('tasks', { data: null, error: null }) // delete source
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'task',
        source_id: UUID,
        target_type: 'routine',
        repeat_pattern: 'RRULE:FREQ=WEEKLY',
      }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.type).toBe('routine')
    })

    it('returns 400 when repeat_pattern missing for task -> routine', async () => {
      const factory = createSupabaseMock()
      factory.setResult('tasks', { data: TASK_SOURCE, error: null })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'task',
        source_id: UUID,
        target_type: 'routine',
      }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('repeat_pattern')
    })
  })

  // -----------------------------------------------------------------------
  // Routine -> Task
  // -----------------------------------------------------------------------
  describe('routine -> task', () => {
    it('converts routine to task successfully', async () => {
      const factory = createSupabaseMock()
      factory.setResult('routines', { data: ROUTINE_SOURCE, error: null })
      factory.setResult('tasks', {
        data: { id: 'new-task-1', title: 'Morning standup', time_estimate_minutes: 30 },
        error: null,
      })
      factory.setResult('routines', { data: null, error: null }) // delete source
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'routine',
        source_id: UUID,
        target_type: 'task',
      }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.type).toBe('task')
    })

    it('returns 404 when source routine does not exist', async () => {
      const factory = createSupabaseMock()
      factory.setResult('routines', { data: null, error: { code: 'PGRST116' } })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'routine',
        source_id: UUID,
        target_type: 'task',
      }))

      expect(res.status).toBe(404)
    })
  })

  // -----------------------------------------------------------------------
  // Rollback on source deletion failure
  // -----------------------------------------------------------------------
  describe('rollback', () => {
    it('rolls back created target when source delete fails (event -> task)', async () => {
      const factory = createSupabaseMock()
      // Fetch source event
      factory.setResult('events', { data: EVENT_SOURCE, error: null })
      // Insert task succeeds
      factory.setResult('tasks', { data: { ...TASK_SOURCE, id: 'new-task-1' }, error: null })
      // Delete source event fails
      factory.setResult('events', { data: null, error: { message: 'delete failed' } })
      // Rollback: delete created task
      factory.setResult('tasks', { data: null, error: null })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'event',
        source_id: UUID,
        target_type: 'task',
      }))
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toContain('could not delete source')
    })
  })

  // -----------------------------------------------------------------------
  // Event -> Routine
  // -----------------------------------------------------------------------
  describe('event -> routine', () => {
    it('returns 400 when repeat_pattern missing', async () => {
      const factory = createSupabaseMock()
      factory.setResult('events', { data: EVENT_SOURCE, error: null })
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'event',
        source_id: UUID,
        target_type: 'routine',
      }))
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.error).toContain('repeat_pattern')
    })

    it('converts event to routine with repeat_pattern', async () => {
      const factory = createSupabaseMock()
      factory.setResult('events', { data: EVENT_SOURCE, error: null })
      factory.setResult('routines', {
        data: { id: 'new-routine-1', title: 'Weekly standup' },
        error: null,
      })
      factory.setResult('events', { data: null, error: null }) // delete source
      mockAuthenticate.mockResolvedValue({ userId: 'user-123', supabase: factory.build() })

      const { POST } = await import('../route')
      const res = await POST(makeRequest({
        source_type: 'event',
        source_id: UUID,
        target_type: 'routine',
        repeat_pattern: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      }))
      const json = await res.json()

      expect(res.status).toBe(201)
      expect(json.type).toBe('routine')
    })
  })
})
