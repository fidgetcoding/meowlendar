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

  // Optional tag filter: resolve the tag's task ids first (RLS-scoped), then
  // constrain the task query. An empty result short-circuits to an empty page.
  let tagTaskIds: string[] | null = null
  if (tagId) {
    const { data: tagRows, error: tagErr } = await supabase
      .from('task_tags')
      .select('task_id')
      .eq('tag_id', tagId)
    if (tagErr) {
      return NextResponse.json({ error: 'Failed to filter by tag' }, { status: 500 })
    }
    tagTaskIds = (tagRows ?? []).map((r) => r.task_id)
    if (tagTaskIds.length === 0) {
      return NextResponse.json(paginate([], searchParams))
    }
  }

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
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

  if (tagTaskIds) query = query.in('id', tagTaskIds)

  const { data: tasks, error } = await query

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    )
  }

  if (tasks.length === 0) {
    return NextResponse.json(paginate([], searchParams))
  }

  const taskIds = tasks.map((t) => t.id)

  const { data: taskTags, error: tagsError } = await supabase
    .from('task_tags')
    .select('task_id, tag_id, tags(id, name, color, prefix)')
    .in('task_id', taskIds)

  if (tagsError) {
    return NextResponse.json(
      { error: 'Failed to fetch task tags' },
      { status: 500 }
    )
  }

  const tagsByTaskId: Record<string, unknown[]> = {}
  for (const tt of taskTags ?? []) {
    if (!tagsByTaskId[tt.task_id]) {
      tagsByTaskId[tt.task_id] = []
    }
    tagsByTaskId[tt.task_id]!.push(tt.tags)
  }

  const tasksWithTags = tasks.map((task) => ({
    ...task,
    tags: tagsByTaskId[task.id] ?? [],
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
