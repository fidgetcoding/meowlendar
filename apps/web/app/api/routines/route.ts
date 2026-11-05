
import { readAll } from '@/lib/read-all'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../lib/auth/helpers'
import { createRoutineSchema } from '@poolendar/validators'
import { paginate } from '../../../lib/pagination'
import { alreadyCreated, clientIdOf, UNIQUE_VIOLATION } from '../../../lib/client-id'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const { data, error } = await readAll(supabase
    .from('routines')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id'))

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch routines' },
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

  const parsed = createRoutineSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const input = parsed.data

  // The same create sent twice (the page resends it while unloading) makes one row.
  const clientId = clientIdOf(body)
  if (clientId) {
    const already = await alreadyCreated(supabase, 'routines', clientId, userId)
    if (already) return NextResponse.json(already, { status: 200 })
  }

  const { data, error } = await supabase
    .from('routines')
    .insert({
      ...(clientId ? { id: clientId } : {}),
      user_id: userId,
      calendar_id: input.calendar_id ?? null,
      title: input.title,
      notes: input.notes ?? null,
      start_time: input.start_time,
      end_time: input.end_time,
      timezone: input.timezone,
      recurrence_rule: input.recurrence_rule,
      location: input.location ?? null,
      visibility: input.visibility,
      privacy: input.privacy,
      reminders: input.reminders,
    })
    .select()
    .single()

  if (error?.code === UNIQUE_VIOLATION && clientId) {
    const already = await alreadyCreated(supabase, 'routines', clientId, userId)
    if (already) return NextResponse.json(already, { status: 200 })
  }
  if (error || !data) {
    return NextResponse.json(
      { error: 'Failed to create routine' },
      { status: 500 }
    )
  }

  return NextResponse.json(data, { status: 201 })
}
