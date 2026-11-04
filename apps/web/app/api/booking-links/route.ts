
import { readAll } from '@/lib/read-all'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../lib/auth/helpers'
import { createBookingLinkSchema } from '@poolendar/validators'
import { paginate } from '../../../lib/pagination'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const { data, error } = await readAll(supabase
    .from('booking_links')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id'))

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch booking links' },
      { status: 500 }
    )
  }

  return NextResponse.json(paginate(data ?? [], request.nextUrl.searchParams))
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const parsed = createBookingLinkSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const input = parsed.data

  // If a google_account_id is provided, verify it belongs to this user
  if (input.google_account_id) {
    const { data: account, error: accountError } = await supabase
      .from('google_accounts')
      .select('id')
      .eq('id', input.google_account_id)
      .eq('user_id', userId)
      .single()

    if (accountError || !account) {
      return NextResponse.json(
        { error: 'Google account not found or access denied' },
        { status: 404 }
      )
    }
  }

  const { data, error } = await supabase
    .from('booking_links')
    .insert({
      user_id: userId,
      slug: input.slug,
      name: input.name,
      duration_minutes: input.duration_minutes,
      availability: input.availability,
      timezone: input.timezone,
      google_account_id: input.google_account_id ?? null,
      conferencing: input.conferencing,
      location: input.location ?? null,
      notes: input.notes ?? null,
      is_public: input.is_public,
      requires_approval: input.requires_approval,
      buffer_minutes: input.buffer_minutes,
      minimum_notice_hours: input.minimum_notice_hours,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A booking link with this slug already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to create booking link' },
      { status: 500 }
    )
  }

  return NextResponse.json(data, { status: 201 })
}
