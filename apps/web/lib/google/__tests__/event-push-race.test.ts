// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { pushEvent } from '../sync'
import type { Calendar, CalendarEvent } from '@poolendar/types'
const { snapshot, latest } = vi.hoisted(() => ({
  snapshot: { id: '00000000-0000-4000-8000-000000000001', calendar_id: 'cal', title: 'Before', updated_at: '2030-01-01T00:00:00Z', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', timezone: 'UTC', attendees: [], reminders: [], google_event_id: null },
  latest: { title: 'Edited while pushing', sync_status: 'pending_push' },
}))
vi.mock('../calendar', () => ({ createGoogleEvent: vi.fn().mockResolvedValue({ id: 'me00000000000040008000000000000001', etag: 'remote' }) }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({
  rpc: async (name: string) => ({ data: name === 'prepare_event_push' ? { ...snapshot, google_event_id: 'me00000000000040008000000000000001' } : latest, error: null }),
  from: () => { const query: Record<string, unknown> = {}; for (const method of ['update', 'eq', 'select']) query[method] = () => query; query.single = async () => ({ data: { ...snapshot, sync_status: 'synced' }, error: null }); return query },
}) }))
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:4392')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-only')
it('returns the newer pending local edit instead of marking an old push clean', async () => {
  const result = await pushEvent(snapshot as unknown as CalendarEvent, { id: 'cal', google_account_id: 'account', google_calendar_id: 'primary' } as Calendar)
  expect(result).toMatchObject(latest)
})
