import { expect, it, vi } from 'vitest'
import { applyScopedEdit } from '../recurrence-edit'
import type { SupabaseClient } from '@supabase/supabase-js'
it('does not commit master exceptions separately from a failed detached occurrence', async () => {
  const writes: string[] = []
  const client = { rpc: vi.fn().mockResolvedValue({ error: { message: 'write failed' }, data: null }), from: () => {
    const query: Record<string, unknown> = {}
    let failed = false
    query.update = () => { writes.push('master updated'); return query }
    query.insert = () => { failed = true; return query }
    query.eq = query.select = () => query
    query.single = async () => ({ data: null, error: { message: 'write failed' } })
    query.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: null, error: failed ? { message: 'write failed' } : null }).then(resolve)
    return query
  } } as unknown as SupabaseClient
  const master = { id: 'master', updated_at: '2030-01-01T00:00:00Z', start_time: '2030-01-07T14:00:00Z', end_time: '2030-01-07T15:00:00Z', recurrence_rule: 'FREQ=DAILY', recurrence_exceptions: [] } as Parameters<typeof applyScopedEdit>[1]
  await expect(applyScopedEdit(client, master, { scope: 'single', occurrenceStart: '2030-01-08T14:00:00Z', patch: { title: 'Changed' } })).rejects.toThrow()
  expect(writes).toEqual([])
})
