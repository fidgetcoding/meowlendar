
import { readAll } from '@/lib/read-all'
import { omit } from '@/lib/omit'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../lib/auth/helpers'
import { createTaskSchema } from '@poolendar/validators'
import { paginate } from '../../../lib/pagination'

// Postgres unique_violation. The only unique index on a task is (user_id, vault_ref).
const UNIQUE_VIOLATION = '23505'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { searchParams } = request.nextUrl

  const status = searchParams.get('status')
  const board = searchParams.get('board')
  const parentId = searchParams.get('parent_id')
  const includeChildren = searchParams.get('include_children')
  const scheduledFrom = searchParams.get('scheduled_from')
  const scheduledTo = searchParams.get('scheduled_to')
  const dueFrom = searchParams.get('due_from')
  const dueTo = searchParams.get('due_to')
  const tagId = searchParams.get('tag_id')

  const taskQuery = tagId
    ? supabase.from('tasks').select('*, task_tags(tag_id, tags(id, name, color, prefix)), matching_tags:task_tags!inner(tag_id)')
    : supabase.from('tasks').select('*, task_tags(tag_id, tags(id, name, color, prefix))')
  let query = taskQuery.eq('user_id', userId)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (board) query = query.eq('board', board)

  // Parent/children scoping (#23e): split children belong on the calendar and
  // kanban, so they are NOT hidden by default anymore.
  //   parent_id=<uuid>       → that parent's children
  //   include_children=false → top-level tasks only (legacy behavior)
  //   (default)              → all tasks, children included
  if (parentId) {
    query = query.eq('parent_id', parentId)
  } else if (includeChildren === 'false') {
    query = query.is('parent_id', null)
  }

  // Scheduled date-range filter (calendar window), by scheduled_start.
  if (scheduledFrom) query = query.gte('scheduled_start', scheduledFrom)
  if (scheduledTo) query = query.lte('scheduled_start', scheduledTo)
  // Due date-range filter.
  if (dueFrom) query = query.gte('due_date', dueFrom)
  if (dueTo) query = query.lte('due_date', dueTo)

  if (tagId) query = query.eq('matching_tags.tag_id', tagId)

  const { data: tasks, error } = await readAll(query.order('id'))

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    )
  }

  if (!tasks?.length) {
    return NextResponse.json(paginate([], searchParams))
  }

  const tasksWithTags = tasks.map(({ task_tags, ...task }) => ({
    ...omit(task, ['matching_tags']),
    tags: (task_tags ?? []).map((row: { tags: unknown }) => row.tags),
  }))

  return NextResponse.json(paginate(tasksWithTags, searchParams))
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

  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const { tag_ids, subtasks, ...input } = parsed.data

  // Cross-tenant guard: reject unknown/foreign tag ids before creating anything.
  if (tag_ids.length > 0) {
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

  // Atomic multi-table write (task + tags + subtasks) via a SECURITY INVOKER
  // Postgres function, so a mid-sequence failure can't leave a half-written
  // task. RLS still applies (user_id := auth.uid() inside the function).
  const { data: task, error: rpcError } = await supabase.rpc('create_task_with_children', {
    p_task: input,
    p_tag_ids: tag_ids,
    p_subtasks: subtasks ?? [],
  })

  if (rpcError?.code === UNIQUE_VIOLATION) {
    return NextResponse.json(
      { error: 'Another task already uses this vault_ref' },
      { status: 409 }
    )
  }

  if (rpcError || !task) {
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    )
  }

  return NextResponse.json(task, { status: 201 })
}
