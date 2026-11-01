import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../lib/auth/helpers'
import { z } from 'zod'

const timeBlockSchema = z.object({
  day: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  time_blocks: z.array(timeBlockSchema).default([]),
})

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth

  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch schedules' },
      { status: 500 }
    )
  }

  return NextResponse.json(data)
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

  const parsed = createScheduleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation error',
        details: parsed.error.issues.reduce(
          (acc, issue) => {
            const key = issue.path.join('.') || '_root'
            if (!acc[key]) acc[key] = []
            acc[key].push(issue.message)
            return acc
          },
          {} as Record<string, string[]>
        ),
      },
      { status: 400 }
    )
  }

  const input = parsed.data

  const { data, error } = await supabase
    .from('schedules')
    .insert({
      user_id: userId,
      name: input.name,
      time_blocks: input.time_blocks,
    })
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: 'Failed to create schedule' },
      { status: 500 }
    )
  }

  return NextResponse.json(data, { status: 201 })
}
