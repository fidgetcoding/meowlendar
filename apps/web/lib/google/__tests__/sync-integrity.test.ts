import { beforeEach, expect, it, vi } from 'vitest'
import { pullChanges } from '../sync'

const { db, listEvents } = vi.hoisted(() => ({
  db: {
    fail: 'insert',
    existing: null as null | Record<string, unknown>,
    writes: [] as { table: string; operation: string; payload: Record<string, unknown> }[],
  },
  listEvents: vi.fn(),
}))
vi.mock('../oauth', () => ({ syncCalendarList: vi.fn() }))
vi.mock('../calendar', () => ({ listGoogleEvents: listEvents }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ rpc: async (name: string) => name === 'claim_account_sync' ? { data: 'fixture-lock', error: null } : name === 'renew_account_sync' || name === 'release_account_sync' ? { data: true, error: null } : db.fail === 'insert' ? { data: null, error: { message: 'fixture storage failure' } } : { data: 'created', error: null }, from: (table: string) => {
    let operation = 'read'
    let offset = 0
    let payload: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    for (const method of ['eq', 'neq', 'order', 'select']) builder[method] = () => builder
    for (const method of ['insert', 'update', 'delete']) builder[method] = (value: Record<string, unknown>) => {
      operation = method
      payload = value ?? {}
      return builder
    }
    builder.range = (from: number) => { offset = from; return builder }
    const result = () => {
      if (operation !== 'read') db.writes.push({ table, operation, payload })
      if (table === 'events' && operation === db.fail) return { data: null, error: { message: 'fixture storage failure' } }
      return { error: null, data: operation !== 'read' ? null : table === 'google_accounts'
        ? { user_id: 'user' } : table === 'calendars'
          ? (offset === 0 ? [{ id: 'cal', google_calendar_id: 'primary', sync_token: 'old' }] : []) : db.existing }
    }
    builder.single = builder.maybeSingle = async () => result()
    builder.then = (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve)
    return builder
  } }),
}))
beforeEach(() => {
  db.writes = []
  db.existing = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:4392'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'
  listEvents.mockResolvedValue({ items: [{ id: 'remote', summary: 'Meeting', start: { dateTime: '2026-03-02T09:00:00Z' }, end: { dateTime: '2026-03-02T10:00:00Z' }, etag: 'new', status: 'confirmed' }], nextSyncToken: 'next' })
})
it('retains the old sync cursor when storing an incoming event fails', async () => {
  db.fail = 'insert'
  await expect(pullChanges('account')).rejects.toThrow('fixture storage failure')
  expect(db.writes.some((write) => write.payload.sync_token === 'next')).toBe(false)
})

it.each(['read', 'update', 'delete'])('retains the cursor on an incoming event %s failure', async (operation) => {
  db.fail = operation
  db.existing = { id: 'local', etag: 'old', sync_status: 'synced' }
  if (operation === 'delete') listEvents.mockResolvedValue({ items: [{ id: 'remote', status: 'cancelled' }], nextSyncToken: 'next' })
  await expect(pullChanges('account')).rejects.toThrow('fixture storage failure')
  expect(db.writes.some((write) => write.payload.sync_token === 'next')).toBe(false)
})

it('drops an incremental page token when falling back from an expired sync cursor', async () => {
  db.fail = ''
  listEvents.mockReset()
  listEvents.mockResolvedValueOnce({ items: [], nextPageToken: 'incremental-page' })
    .mockRejectedValueOnce(new Error('410 Gone'))
    .mockResolvedValueOnce({ items: [], nextSyncToken: 'replacement' })
  await pullChanges('account')
  expect(listEvents.mock.calls[2]![2].pageToken).toBeUndefined()
  expect(listEvents.mock.calls[2]![2].syncToken).toBeUndefined()
})

it('keeps an ordinary event with a pending local edit when Google cancels its old copy', async () => {
  db.fail = ''
  db.existing = { id: 'local', etag: 'old', sync_status: 'pending_push', updated_at: '2026-01-01T00:00:00Z' }
  listEvents.mockResolvedValue({ items: [{ id: 'remote', status: 'cancelled' }], nextSyncToken: 'next' })
  await pullChanges('account')
  expect(db.writes.filter(write => write.table === 'events')).toEqual([])
})
