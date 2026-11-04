import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../lib/auth/helpers'
import { omit } from '../../../../lib/omit'
import { updateTaskSchema } from '@poolendar/validators'

type RouteParams = { params: Promise<{ id: string }> }

// Postgres unique_violation. The only unique index on a task is (user_id, vault_ref).
const UNIQUE_VIOLATION = '23505'

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error || !task) {
    return NextResponse.json(
      { error: 'Task not found' },
      { status: 404 }
    )
  }

  const [subtasksResult, childrenResult, tagsResult] = await Promise.all([
    supabase
      .from('subtasks')
      .select('*')
      .eq('task_id', id)
      .order('position', { ascending: true }),
    supabase
      .from('tasks')
      .select('*')
      .eq('parent_id', id)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('task_tags')
      .select('tag_id, tags(id, name, color, prefix)')
      .eq('task_id', id),
  ])

  return NextResponse.json({
    ...task,
    subtasks: subtasksResult.data ?? [],
    children: childrenResult.data ?? [],
    tags: (tagsResult.data ?? []).map((r) => r.tags),
  })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('tasks')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: 'Task not found' },
      { status: 404 }
    )
  }

  const { tag_ids } = parsed.data
  const fields = omit(parsed.data, ['tag_ids', 'subtasks'])

  // Cross-tenant guard: every provided tag must belong to the caller before we
  // touch task_tags. Reject up front so no task fields are mutated on a bad id.
  if (tag_ids !== undefined && tag_ids.length > 0) {
    const { data: ownedTags } = await supabase
      .from('tags')
      .select('id')
      .eq('user_id', userId)
      .in('id', tag_ids)
    const ownedIds = new Set((ownedTags ?? []).map((t) => t.id))
    const invalid = tag_ids.filter((tid) => !ownedIds.has(tid))
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: 'One or more tag_ids do not belong to you', invalid_tag_ids: invalid },
        { status: 400 }
      )
    }
  }

  // Handle completed_at. A caller may supply the date (the vault sync does, from
  // a line's done date). Otherwise it follows the status transition. A task that
  // is not done never carries one, and a done task can't have its date blanked.
  const updateFields: Record<string, unknown> = { ...fields }
  const nextStatus = fields.status ?? existing.status
  if (nextStatus === 'done') {
    if (existing.status !== 'done') {
      updateFields.completed_at = fields.completed_at ?? new Date().toISOString()
    } else if (fields.completed_at == null) {
      delete updateFields.completed_at
    }
  } else if (existing.status === 'done') {
    updateFields.completed_at = null
  } else {
    delete updateFields.completed_at
  }

  const { data: task, error: updateError } = await supabase.rpc('update_task_with_tags', {
    p_id: id, p_patch: updateFields, p_tag_ids: tag_ids ?? null,
  })

  if (updateError?.code === UNIQUE_VIOLATION) {
    return NextResponse.json(
      { error: 'Another task already uses this vault_ref' },
      { status: 409 }
    )
  }

  if (updateError || !task) {
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    )
  }

  return NextResponse.json(task)
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 }
    )
  }

  return new NextResponse(null, { status: 204 })
}
