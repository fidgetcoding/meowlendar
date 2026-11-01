import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../lib/auth/helpers'
import { omit } from '../../../lib/omit'
import { z } from 'zod'

const undoSchema = z.object({
  action_type: z.enum(['create', 'update', 'delete']),
  entity_type: z.enum(['event', 'task', 'routine', 'booking_link', 'tag', 'schedule']),
  entity_id: z.string().uuid(),
  previous_state: z.record(z.string(), z.any()).nullable(),
})

// Fields a client must never restore: they could hijack ownership or bypass constraints.
const PROTECTED_FIELDS = [
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'etag',
  'sync_status',
  'google_event_id',
] as const

const tableMap: Record<string, string> = {
  event: 'events',
  task: 'tasks',
  routine: 'routines',
  booking_link: 'booking_links',
  tag: 'tags',
  schedule: 'schedules',
}

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

  const parsed = undoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { action_type, entity_type, entity_id, previous_state } = parsed.data
  const table = tableMap[entity_type]

  if (!table) {
    return NextResponse.json({ error: 'Unknown entity type' }, { status: 400 })
  }

  // Undo a CREATE -> delete the entity
  if (action_type === 'create') {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', entity_id)
      .eq('user_id', userId)

    if (error) {
      return NextResponse.json({ error: 'Failed to undo create' }, { status: 500 })
    }

    return new NextResponse(null, { status: 204 })
  }

  // Undo a DELETE -> re-insert the entity with previous_state
  if (action_type === 'delete') {
    if (!previous_state) {
      return NextResponse.json({ error: 'previous_state is required to undo a delete' }, { status: 400 })
    }

    // Strip dangerous fields that could be used to hijack ownership or bypass constraints
    const safeState = omit(previous_state, PROTECTED_FIELDS)

    const { data, error } = await supabase
      .from(table)
      .insert({ ...safeState, id: entity_id, user_id: userId })
      .select()
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to undo delete' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  }

  // Undo an UPDATE -> restore previous_state
  if (action_type === 'update') {
    if (!previous_state) {
      return NextResponse.json({ error: 'previous_state is required to undo an update' }, { status: 400 })
    }

    // Strip dangerous fields that could be used to hijack ownership or bypass constraints
    const restoreFields = omit(previous_state, PROTECTED_FIELDS)

    const { data, error } = await supabase
      .from(table)
      .update(restoreFields)
      .eq('id', entity_id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to undo update' }, { status: 500 })
    }

    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Invalid action_type' }, { status: 400 })
}
