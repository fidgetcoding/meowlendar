import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../lib/auth/helpers'
import { omit } from '../../../../lib/omit'
import { updateTaskSchema } from '@poolendar/validators'

type RouteParams = { params: Promise<{ id: string }> }

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

  // Handle completed_at transitions
  const updateFields: Record<string, unknown> = { ...fields }
  if (fields.status !== undefined) {
    if (fields.status === 'done' && existing.status !== 'done') {
      updateFields.completed_at = new Date().toISOString()
    } else if (fields.status !== 'done' && existing.status === 'done') {
      updateFields.completed_at = null
    }
  }

  const { data: task, error: updateError } = await supabase
    .from('tasks')
    .update(updateFields)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (updateError || !task) {
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    )
  }

  // Replace tags if provided
  if (tag_ids !== undefined) {
    await supabase
      .from('task_tags')
      .delete()
      .eq('task_id', id)

    if (tag_ids.length > 0) {
      const tagRows = tag_ids.map((tagId) => ({
        task_id: id,
        tag_id: tagId,
      }))

      await supabase
        .from('task_tags')
        .insert(tagRows)
    }
  }

  // Fetch tags for response
  const { data: tagRecords } = await supabase
    .from('task_tags')
    .select('tag_id, tags(id, name, color, prefix)')
    .eq('task_id', id)

  return NextResponse.json({
    ...task,
    tags: (tagRecords ?? []).map((r) => r.tags),
  })
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
