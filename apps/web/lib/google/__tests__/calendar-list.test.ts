import { beforeEach, expect, it, vi } from 'vitest'
import { syncCalendarList } from '../oauth'

const { mutations } = vi.hoisted(() => ({ mutations: [] as string[] }))
vi.mock('../calendar', () => ({ getGoogleAccessToken: async () => 'fixture-token' }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: () => {
  const query: Record<string, unknown> = {}
  let operation = 'read'
  let offset = 0
  query.select = query.order = query.eq = () => query
  for (const method of ['update', 'insert', 'delete']) query[method] = () => { operation = method; mutations.push(method); return query }
  query.range = (from: number) => { offset = from; return query }
  query.then = (resolve: (value: unknown) => void) => Promise.resolve({ error: null, data: operation === 'read' ? (offset ? [] : [{ id: 'one', google_calendar_id: 'first' }, { id: 'two', google_calendar_id: 'second' }]) : null }).then(resolve)
  return query
} }) }))
beforeEach(() => {
  mutations.length = 0
  vi.mocked(fetch).mockReset()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:4392'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'
})
it('reads every Google calendar page before removing missing local calendars', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'first' }], nextPageToken: 'page-two' }) } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'second' }] }) } as Response)
  await syncCalendarList('account', 'user')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(new URL(String(vi.mocked(fetch).mock.calls[1]![0])).searchParams.get('pageToken')).toBe('page-two')
  expect(mutations).toEqual(['update', 'update'])
})

it('makes no local calendar changes if a later Google page fails', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'first' }], nextPageToken: 'page-two' }) } as Response)
    .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
  await expect(syncCalendarList('account', 'user')).rejects.toThrow('503')
  expect(mutations).toEqual([])
})
