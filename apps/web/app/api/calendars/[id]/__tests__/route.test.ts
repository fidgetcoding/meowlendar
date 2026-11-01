import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

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

vi.mock('@/lib/google/oauth', () => ({
  disconnectGoogleAccount: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/google/calendar', () => ({
  updateGoogleCalendarColor: vi.fn().mockResolvedValue({}),
}))

import { PATCH, DELETE } from '../route'
import { authenticate } from '@/lib/auth/helpers'
import type { AuthResult } from '@/lib/auth/helpers'
import { disconnectGoogleAccount } from '@/lib/google/oauth'
import { updateGoogleCalendarColor } from '@/lib/google/calendar'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001'
const CAL_ID = '00000000-0000-4000-8000-0000000000c1'

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const methods = ['select', 'update', 'delete', 'eq', 'order']
  for (const m of methods) builder[m] = vi.fn().mockReturnValue(builder)
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockAuthWithTables(
  tableResults: Record<
    string,
    { data: unknown; error: unknown } | { data: unknown; error: unknown }[]
  >
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

function patchReq(body: unknown): NextRequest {
  return new NextRequest(new URL(`/api/calendars/${CAL_ID}`, 'http://localhost:3000'), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function deleteReq(): NextRequest {
  return new NextRequest(new URL(`/api/calendars/${CAL_ID}`, 'http://localhost:3000'), {
    method: 'DELETE',
  })
}

const params = Promise.resolve({ id: CAL_ID })
const calRow = { id: CAL_ID, google_account_id: 'ga-1', google_calendar_id: 'gc-1' }

describe('PATCH /api/calendars/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('toggles is_active without touching Google', async () => {
    mockAuthWithTables({
      calendars: [
        { data: calRow, error: null },
        { data: { ...calRow, is_active: false }, error: null },
      ],
    })

    const res = await PATCH(patchReq({ is_active: false }), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.is_active).toBe(false)
    expect(updateGoogleCalendarColor).not.toHaveBeenCalled()
  })

  it('pushes a colour change to Google', async () => {
    mockAuthWithTables({
      calendars: [
        { data: calRow, error: null },
        { data: { ...calRow, color: '#ff0000' }, error: null },
      ],
    })

    const res = await PATCH(patchReq({ color: '#ff0000' }), { params })

    expect(res.status).toBe(200)
    expect(updateGoogleCalendarColor).toHaveBeenCalledWith('ga-1', 'gc-1', '#ff0000')
  })

  it('swallows a Google colour-push failure and still stores locally', async () => {
    vi.mocked(updateGoogleCalendarColor).mockRejectedValueOnce(new Error('google down'))
    mockAuthWithTables({
      calendars: [
        { data: calRow, error: null },
        { data: { ...calRow, color: '#00ff00' }, error: null },
      ],
    })

    const res = await PATCH(patchReq({ color: '#00ff00' }), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.color).toBe('#00ff00')
  })

  it('returns 400 on an empty patch body', async () => {
    mockAuthWithTables({})
    const res = await PATCH(patchReq({}), { params })
    expect(res.status).toBe(422)
  })

  it('returns 400 on an invalid colour', async () => {
    mockAuthWithTables({})
    const res = await PATCH(patchReq({ color: 'red' }), { params })
    expect(res.status).toBe(422)
  })

  it('returns 404 when the calendar is not owned by the caller', async () => {
    mockAuthWithTables({ calendars: { data: null, error: { code: 'PGRST116' } } })
    const res = await PATCH(patchReq({ is_active: true }), { params })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/calendars/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('disconnects the account that owns the calendar', async () => {
    mockAuthWithTables({
      calendars: { data: { google_account_id: 'ga-1' }, error: null },
    })

    const res = await DELETE(deleteReq(), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(disconnectGoogleAccount).toHaveBeenCalledWith('ga-1')
  })

  it('returns 404 (and does not disconnect) when the calendar is not owned', async () => {
    mockAuthWithTables({ calendars: { data: null, error: { code: 'PGRST116' } } })

    const res = await DELETE(deleteReq(), { params })

    expect(res.status).toBe(404)
    expect(disconnectGoogleAccount).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    vi.mocked(authenticate).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await DELETE(deleteReq(), { params })
    expect(res.status).toBe(401)
  })
})
