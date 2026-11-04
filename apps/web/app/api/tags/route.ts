
import { readAll } from '@/lib/read-all'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../lib/auth/helpers'
import { createTagSchema } from '@poolendar/validators'
import { paginate } from '../../../lib/pagination'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const { data, error } = await readAll(supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true }).order('id'))

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch tags' },
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

  const parsed = createTagSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const input = parsed.data

  const { data, error } = await supabase
    .from('tags')
    .insert({
      user_id: userId,
      name: input.name,
      color: input.color,
      prefix: input.prefix ?? null,
    })
    .select()
    .single()

  if (error) {
    // Handle unique constraint violation (user_id, name)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A tag with this name already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to create tag' },
      { status: 500 }
    )
  }

  return NextResponse.json(data, { status: 201 })
}
