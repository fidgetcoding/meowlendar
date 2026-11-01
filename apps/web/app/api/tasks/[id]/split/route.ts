import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError, validationError } from '../../../../../lib/auth/helpers'
import { splitTaskSchema } from '@poolendar/validators'

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = splitTaskSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const { chunks } = parsed.data

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (taskError || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (task.is_split) {
    return NextResponse.json({ error: 'Task is already split' }, { status: 400 })
  }

  const { data: subtasks } = await supabase
    .from('subtasks')
    .select('*')
    .eq('task_id', id)
    .order('position', { ascending: true })

  const { data: taskTags } = await supabase
    .from('task_tags')
    .select('tag_id')
    .eq('task_id', id)

  const tagIds = (taskTags ?? []).map((tt: { tag_id: string }) => tt.tag_id)
  const hasSubtasks = subtasks && subtasks.length > 0

  if (!hasSubtasks && !chunks) {
    return NextResponse.json(
      { error: 'Task has no subtasks. Provide "chunks" to split into N equal parts.' },
      { status: 400 }
    )
  }

  if (!hasSubtasks && chunks && !task.time_estimate_minutes) {
    return NextResponse.json(
      { error: 'Task has no time estimate. Set a time estimate before splitting without subtasks.' },
      { status: 400 }
    )
  }

  // Compute the child rows; the atomic write (insert children + copy tags +
  // clear subtasks + flip the parent) happens in the split_task RPC.
  let childRows: Record<string, unknown>[]

  if (hasSubtasks) {
    const parentDuration = task.time_estimate_minutes
    const n = subtasks!.length
    childRows = subtasks!.map((subtask) => ({
      calendar_id: task.calendar_id,
      title: subtask.title,
      notes: null,
      importance: task.importance,
      time_estimate_minutes: subtask.time_estimate_minutes
        ?? (parentDuration ? Math.round(parentDuration / n) : null),
      earliest_start: task.earliest_start,
      due_date: task.due_date,
      status: subtask.completed ? 'done' : task.status,
      board: task.board,
      visibility: task.visibility,
      privacy: task.privacy,
      flexibility: task.flexibility,
      reminders: task.reminders,
      completed_at: subtask.completed ? new Date().toISOString() : null,
      position: subtask.position,
    }))
  } else {
    const n = chunks!
    const perChunk = Math.round(task.time_estimate_minutes! / n)
    childRows = Array.from({ length: n }, (_, i) => ({
      calendar_id: task.calendar_id,
      title: `${task.title} (${i + 1}/${n})`,
      notes: null,
      importance: task.importance,
      time_estimate_minutes: perChunk,
      earliest_start: task.earliest_start,
      due_date: task.due_date,
      status: task.status,
      board: task.board,
      visibility: task.visibility,
      privacy: task.privacy,
      flexibility: task.flexibility,
      reminders: task.reminders,
      completed_at: null,
      position: i + 1.0,
    }))
  }

  const { data: result, error: rpcError } = await supabase.rpc('split_task', {
    p_parent_id: id,
    p_children: childRows,
    p_tag_ids: tagIds,
    p_delete_subtasks: !!hasSubtasks,
  })

  if (rpcError || !result?.parent) {
    return NextResponse.json({ error: 'Failed to split task' }, { status: 500 })
  }

  return NextResponse.json({
    ...result.parent,
    children: result.children ?? [],
  })
}
