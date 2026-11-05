import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PoolendarClient } from '../client.js'

/**
 * Unit tests for the @poolendar/api-client package.
 * Mocks global fetch to verify request construction and response handling.
 */

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status < 300 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
  })
}

function lastCall() {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
  return calls[calls.length - 1]!
}

describe('PoolendarClient (api-client package)', () => {
  const BASE = 'https://app.poolendar.com'
  const KEY = 'pk_test_xyz'

  let client: PoolendarClient

  beforeEach(() => {
    client = new PoolendarClient({ baseUrl: BASE, apiKey: KEY })
    globalThis.fetch = mockFetch({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- Constructor ----

  describe('constructor', () => {
    it('trims trailing slash from baseUrl', async () => {
      const c = new PoolendarClient({ baseUrl: 'https://x.com/', apiKey: KEY })
      globalThis.fetch = mockFetch([])
      await c.listTags()
      const [url] = lastCall()
      expect(url).toBe('https://x.com/api/tags')
    })

    it('sets Bearer auth from apiKey', async () => {
      globalThis.fetch = mockFetch([])
      await client.listTags()
      const [, opts] = lastCall()
      expect(opts.headers.Authorization).toBe(`Bearer ${KEY}`)
    })

    it('sets Bearer auth from token', async () => {
      const c = new PoolendarClient({ baseUrl: BASE, token: 'tok_abc' })
      globalThis.fetch = mockFetch([])
      await c.listTags()
      const [, opts] = lastCall()
      expect(opts.headers.Authorization).toBe('Bearer tok_abc')
    })

    it('prefers token over apiKey when both provided', async () => {
      const c = new PoolendarClient({ baseUrl: BASE, apiKey: KEY, token: 'tok_override' })
      globalThis.fetch = mockFetch([])
      await c.listTags()
      const [, opts] = lastCall()
      // Based on source: token assignment comes after apiKey, so it wins
      expect(opts.headers.Authorization).toBe('Bearer tok_override')
    })
  })

  // ---- Request headers ----

  describe('request headers', () => {
    it('always sends Content-Type: application/json', async () => {
      globalThis.fetch = mockFetch({})
      await client.getProfile()
      const [, opts] = lastCall()
      expect(opts.headers['Content-Type']).toBe('application/json')
    })

    it('includes Authorization on every request', async () => {
      globalThis.fetch = mockFetch({})
      await client.getProfile()
      const [, opts] = lastCall()
      expect(opts.headers).toHaveProperty('Authorization')
    })
  })

  // ---- Response parsing ----

  describe('response parsing', () => {
    it('returns parsed JSON on success', async () => {
      const data = { id: 't-1', title: 'Test Task' }
      globalThis.fetch = mockFetch(data)
      const result = await client.getTask('t-1')
      expect(result).toEqual(data)
    })

    it('returns arrays correctly', async () => {
      const data = [{ id: '1' }, { id: '2' }]
      globalThis.fetch = mockFetch(data)
      const result = await client.listTags()
      expect(result).toEqual(data)
      expect(result).toHaveLength(2)
    })
  })

  // ---- Error handling ----

  describe('error handling', () => {
    it('throws ApiError on 400', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Missing title' }),
      })
      await expect(client.createTask({} as any)).rejects.toThrow('Missing title')
    })

    it('throws ApiError on 401', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ error: 'Invalid API key' }),
      })
      await expect(client.getProfile()).rejects.toThrow('Invalid API key')
    })

    it('throws ApiError on 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ error: 'Task not found' }),
      })
      await expect(client.getTask('bad-id')).rejects.toThrow('Task not found')
    })

    it('throws ApiError on 500', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      })
      await expect(client.listEvents({ start: '', end: '' })).rejects.toThrow('Server error')
    })

    it('falls back to statusText when error body is empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: vi.fn().mockResolvedValue({}),
      })
      await expect(client.listTasks()).rejects.toThrow('Service Unavailable')
    })

    it('falls back to statusText when json() fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: vi.fn().mockRejectedValue(new Error('parse fail')),
      })
      await expect(client.listTasks()).rejects.toThrow('Bad Gateway')
    })

    it('error has status property', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({ error: 'Rate limited' }),
      })
      try {
        await client.listTasks()
        expect.fail('Should throw')
      } catch (err: any) {
        expect(err.status).toBe(429)
        expect(err.name).toBe('ApiError')
      }
    })
  })

  // ---- Endpoint + method mapping ----

  describe('endpoint mapping', () => {
    // Events
    it('listEvents calls GET /api/events with query params', async () => {
      globalThis.fetch = mockFetch([])
      await client.listEvents({ start: '2026-01-01', end: '2026-01-07' })
      const [url] = lastCall()
      expect(url).toContain(`${BASE}/api/events`)
      expect(url).toContain('start=2026-01-01')
      expect(url).toContain('end=2026-01-07')
    })

    it('listEvents includes calendar_id in query when provided', async () => {
      globalThis.fetch = mockFetch([])
      await client.listEvents({ start: '2026-01-01', end: '2026-01-07', calendar_id: 'cal-1' })
      const [url] = lastCall()
      expect(url).toContain('calendar_id=cal-1')
    })

    it('createEvent calls POST /api/events', async () => {
      globalThis.fetch = mockFetch({})
      await client.createEvent({ title: 'Team sync' } as any)
      const [url, opts] = lastCall()
      expect(url).toBe(`${BASE}/api/events`)
      expect(opts.method).toBe('POST')
    })

    it('updateEvent calls PATCH /api/events/:id', async () => {
      globalThis.fetch = mockFetch({})
      await client.updateEvent('e-1', { title: 'Updated' } as any)
      const [url, opts] = lastCall()
      expect(url).toBe(`${BASE}/api/events/e-1`)
      expect(opts.method).toBe('PATCH')
    })

    it('deleteEvent calls DELETE /api/events/:id', async () => {
      globalThis.fetch = mockFetch(undefined)
      await client.deleteEvent('e-1')
      const [url, opts] = lastCall()
      expect(url).toBe(`${BASE}/api/events/e-1`)
      expect(opts.method).toBe('DELETE')
    })

    // Tasks
    it('listTasks with no params calls GET /api/tasks', async () => {
      globalThis.fetch = mockFetch([])
      await client.listTasks()
      const [url] = lastCall()
      expect(url).toBe(`${BASE}/api/tasks`)
    })

    it('createTask calls POST /api/tasks with JSON body', async () => {
      globalThis.fetch = mockFetch({})
      const taskData = { title: 'Ship feature', importance: 'high' }
      await client.createTask(taskData as any)
      const [url, opts] = lastCall()
      expect(url).toBe(`${BASE}/api/tasks`)
      expect(opts.method).toBe('POST')
      expect(JSON.parse(opts.body)).toEqual(taskData)
    })

    it('scheduleTask sends scheduled_start and scheduled_end', async () => {
      globalThis.fetch = mockFetch({})
      await client.scheduleTask('t-1', {
        scheduled_start: '2026-06-15T09:00:00Z',
        scheduled_end: '2026-06-15T10:00:00Z',
      })
      const [, opts] = lastCall()
      const body = JSON.parse(opts.body)
      expect(body.scheduled_start).toBe('2026-06-15T09:00:00Z')
      expect(body.scheduled_end).toBe('2026-06-15T10:00:00Z')
    })

    it('listEvents merges copies by default and asks for every row with merge: false', async () => {
      globalThis.fetch = mockFetch([])
      await client.listEvents({ start: '2026-01-01', end: '2026-01-07' })
      expect(lastCall()[0]).not.toContain('merge=')
      await client.listEvents({ start: '2026-01-01', end: '2026-01-07', merge: false })
      expect(lastCall()[0]).toContain('merge=false')
    })

    // Search
    it('search sends merge=false only when asked', async () => {
      globalThis.fetch = mockFetch([])
      await client.search('kickoff')
      expect(lastCall()[0]).not.toContain('merge=')
      await client.search('kickoff', undefined, undefined, { merge: false })
      expect(lastCall()[0]).toContain('merge=false')
    })

    it('search encodes query parameter', async () => {
      globalThis.fetch = mockFetch([])
      await client.search('team meeting')
      const [url] = lastCall()
      expect(url).toContain('q=team+meeting')
    })

    // Convert
    it('convert sends all three required fields', async () => {
      globalThis.fetch = mockFetch({})
      await client.convert({
        source_type: 'event',
        source_id: 'e-1',
        target_type: 'task',
      })
      const [, opts] = lastCall()
      const body = JSON.parse(opts.body)
      expect(body.source_type).toBe('event')
      expect(body.source_id).toBe('e-1')
      expect(body.target_type).toBe('task')
    })

    // Profile
    it('getProfile calls GET /api/profile', async () => {
      globalThis.fetch = mockFetch({})
      await client.getProfile()
      const [url] = lastCall()
      expect(url).toBe(`${BASE}/api/profile`)
    })

    it('updateProfile calls PATCH /api/profile', async () => {
      globalThis.fetch = mockFetch({})
      await client.updateProfile({ username: 'nate' } as any)
      const [url, opts] = lastCall()
      expect(url).toBe(`${BASE}/api/profile`)
      expect(opts.method).toBe('PATCH')
    })
  })

  // ---- Method existence ----

  describe('all expected methods exist on the client', () => {
    const methods = [
      'listEvents', 'getEvent', 'createEvent', 'updateEvent', 'deleteEvent', 'rsvpEvent',
      'listTasks', 'getTask', 'createTask', 'updateTask', 'deleteTask',
      'moveTask', 'splitTask', 'scheduleTask', 'completeTask', 'reopenTask',
      'listSubtasks', 'createSubtask', 'updateSubtask', 'deleteSubtask', 'reorderSubtasks',
      'listRoutines', 'getRoutine', 'createRoutine', 'updateRoutine', 'deleteRoutine',
      'listRoutineInstances', 'updateRoutineInstance',
      'listTags', 'getTag', 'createTag', 'updateTag', 'deleteTag',
      'listBookingLinks', 'getBookingLink', 'createBookingLink',
      'updateBookingLink', 'deleteBookingLink',
      'listBookings', 'bookSlot', 'getAvailability',
      'listSchedules', 'getSchedule', 'createSchedule', 'updateSchedule', 'deleteSchedule',
      'convert', 'search',
      'getProfile', 'updateProfile',
      'deleteAccount',
      'listApiKeys', 'createApiKey', 'deleteApiKey',
      'undo', 'triggerGoogleSync',
    ]

    for (const method of methods) {
      it(`has ${method}()`, () => {
        expect(typeof (client as any)[method]).toBe('function')
      })
    }
  })
})

describe('path segments and empty responses', () => {
  const client = new PoolendarClient({ baseUrl: 'http://x', apiKey: 'pk_test' })

  function stubFetch(status: number, body: string | null) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('encodes ids so they cannot reach another route', async () => {
    const fetchMock = stubFetch(200, '{}')
    await client.getTask('../api-keys/abc')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://x/api/tasks/..%2Fapi-keys%2Fabc')
  })

  it.each(['.', '..', ''])('refuses the dot segment %j', async (id) => {
    stubFetch(200, '{}')
    await expect(client.getTask(id)).rejects.toThrow(/Invalid path segment/)
  })

  it('resolves a 204 without parsing a body', async () => {
    stubFetch(204, null)
    await expect(client.deleteTask('abc')).resolves.toBeUndefined()
  })
})

