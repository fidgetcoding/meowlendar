import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'
vi.mock('@/lib/auth/helpers', () => ({ authenticate: vi.fn(), isAuthError: () => false }))
const id = '00000000-0000-4000-8000-000000000005'
function setup(rule: string, rows: unknown[] = []) {
  const supabase = { from: (table: string) => {
    let from = 0; let to = 999
    const q: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'gte', 'lte', 'order']) q[key] = () => q
    q.range = (a: number, b: number) => { from = a; to = b; return q }
    q.single = async () => ({ data: { recurrence_rule: rule }, error: null })
    q.then = (resolve: (value: unknown) => void) => Promise.resolve({ data: table === 'routine_instances' ? rows.slice(from, Math.min(to + 1, from + 1000)) : null, error: null }).then(resolve)
    return q
  } }
  vi.mocked(authenticate).mockResolvedValue({ userId: id, supabase: supabase as unknown as AuthResult['supabase'] })
}
const request = () => GET(new NextRequest(`http://localhost/api/routines/${id}/instances?start=2030-01-01&end=2035-01-01`), { params: Promise.resolve({ id }) })
beforeEach(() => vi.clearAllMocks())
describe('routine instance scale boundaries', () => {
  it('retains saved states beyond the server row cap', async () => {
    const rows = Array.from({ length: 1207 }, (_, i) => ({ id: String(i), date: new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10), status: 'completed' }))
    setup('DTSTART:20300101T000000Z\nRRULE:FREQ=DAILY;COUNT=1', rows)
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1207)
  })
  it('rejects excessive recurrence output instead of allocating or silently truncating it', async () => {
    setup('DTSTART:20300101T000000Z\nRRULE:FREQ=SECONDLY;COUNT=10001')
    const response = await request()
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('smaller date range')
  })
})
