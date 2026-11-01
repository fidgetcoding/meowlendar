import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/helpers', () => ({
  authenticate: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { GET } from '../route'
import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'order', 'in', 'not', 'or', 'filter']
  for (const m of methods) builder[m] = vi.fn().mockReturnValue(builder)
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockAuthWithTables(
  tableResults: Record<string, { data: unknown; error: unknown }>
) {
  const supabase = {
    from: vi.fn().mockImplementation((table: string) =>
      makeQueryBuilder(tableResults[table] ?? { data: null, error: null })
    ),
  }
  vi.mocked(authenticate).mockResolvedValue({ userId: TEST_USER_ID, supabase: supabase as unknown as AuthResult['supabase'] })
  return supabase
}

function req(): NextRequest {
  return new NextRequest(new URL('/api/calendars', 'http://localhost:3000'), { method: 'GET' })
}

describe('GET /api/calendars', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups each connected account with its own sub-calendars', async () => {
    mockAuthWithTables({
      google_accounts: {
        data: [
          { id: 'ga-1', email: 'a@x.com', last_synced_at: null },
          { id: 'ga-2', email: 'b@x.com', last_synced_at: null },
        ],
        error: null,
      },
      calendars: {
        data: [
          { id: 'c1', google_account_id: 'ga-1', name: 'Primary' },
          { id: 'c2', google_account_id: 'ga-2', name: 'Work' },
          { id: 'c3', google_account_id: 'ga-1', name: 'Birthdays' },
        ],
        error: null,
      },
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.accounts).toHaveLength(2)
    expect(body.accounts[0].id).toBe('ga-1')
    expect(body.accounts[0].calendars.map((c: { id: string }) => c.id)).toEqual(['c1', 'c3'])
    expect(body.accounts[1].calendars.map((c: { id: string }) => c.id)).toEqual(['c2'])
  })

  it('returns an empty list when no accounts are connected', async () => {
    mockAuthWithTables({
      google_accounts: { data: [], error: null },
      calendars: { data: [], error: null },
    })

    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.accounts).toEqual([])
  })

  it('rejects an unauthenticated request', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns 500 when the accounts query fails', async () => {
    mockAuthWithTables({
      google_accounts: { data: null, error: { message: 'db down' } },
    })
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
