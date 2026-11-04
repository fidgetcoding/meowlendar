
import { readAll } from '@/lib/read-all'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, isAuthError, validationError } from '@/lib/auth/helpers'
import type { Calendar } from '@poolendar/types'

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string')
    .default('#f9a825'),
})

const MAX_LOCAL_CALENDARS = 50

/**
 * POST /api/calendars — create a local calendar, which has no Google account
 * behind it. Connecting Google is a separate flow.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return validationError(parsed.error.issues)

  const { count } = await supabase
    .from('calendars')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', 'local')
  if ((count ?? 0) >= MAX_LOCAL_CALENDARS) {
    return NextResponse.json({ error: 'Too many local calendars' }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('calendars')
    .insert({
      user_id: userId,
      source: 'local',
      name: parsed.data.name,
      color: parsed.data.color,
    })
    .select()
    .single()
  if (error || !data) {
    return NextResponse.json({ error: 'Failed to create calendar' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

/**
 * GET /api/calendars — the caller's connected Google accounts, each grouped with
 * its sub-calendars, plus their local calendars. Read from the DB (cached from
 * Google), never a live Google call. User-scoped via RLS.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const { data: accounts, error: accountsError } = await readAll(supabase
    .from('google_accounts')
    .select('id, email, token_expires_at, sync_token, last_synced_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true }).order('id'))

  if (accountsError) {
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    )
  }

  const { data: calendars, error: calendarsError } = await readAll(supabase
    .from('calendars')
    .select('*')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false }).order('id'))

  if (calendarsError) {
    return NextResponse.json(
      { error: 'Failed to fetch calendars' },
      { status: 500 }
    )
  }

  const grouped = (accounts ?? []).map((account) => ({
    ...account,
    calendars: (calendars ?? []).filter(
      (c: Calendar) => c.google_account_id === account.id
    ),
  }))

  return NextResponse.json({
    accounts: grouped,
    local_calendars: (calendars ?? []).filter((c: Calendar) => c.source === 'local'),
  })
}
