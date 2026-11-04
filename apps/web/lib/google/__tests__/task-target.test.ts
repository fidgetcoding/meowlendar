import { expect, it, vi } from 'vitest'
import { flushTaskSync } from '../task-sync'
const { tables } = vi.hoisted(() => ({ tables: [] as string[] }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: (table: string) => {
  tables.push(table)
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'not', 'limit']) query[method] = () => query
  const result = () => table === 'calendars' ? { data: null, error: { message: 'fixture target unavailable' } } : { data: table === 'profiles' ? [{ id: 'user', settings: { task_sync_calendar_id: 'cal' } }] : [], error: null }
  query.maybeSingle = async () => result()
  query.then = (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve)
  return query
} }) }))
it('does not treat an unreadable sync target as turning mirroring off', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:4392'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only'
  await expect(flushTaskSync({ userId: 'user' })).rejects.toThrow('fixture target unavailable')
  expect(tables).not.toContain('tasks')
})
