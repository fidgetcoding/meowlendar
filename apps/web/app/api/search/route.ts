import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../lib/auth/helpers'
import { paginate } from '../../../lib/pagination'

type TaskTagRef = { task_id: string }

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { searchParams } = request.nextUrl

  const q = searchParams.get('q')
  if (!q || q.length === 0) {
    return NextResponse.json({ error: 'Missing required query parameter: q' }, { status: 400 })
  }
  if (q.length > 200) {
    return NextResponse.json({ error: 'Query parameter q must not exceed 200 characters' }, { status: 400 })
  }

  // Sanitize: commas and parens in PostgREST .or() filter values can
  // inject additional filter expressions. Strip them.
  const safeQ = q.replace(/[,()]/g, '')
  if (!safeQ) {
    return NextResponse.json({ error: 'Query contains only special characters' }, { status: 400 })
  }

  const typesParam = searchParams.get('types')
  const types = typesParam ? typesParam.split(',') : ['event', 'task', 'routine', 'booking_link']
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)
  const pattern = `%${safeQ}%`

  const seen = new Set<string>()
  const results: { type: string; id: string; title: string; date: string | null; snippet: string | null }[] = []

  function pushUnique(item: typeof results[number]) {
    const key = `${item.type}:${item.id}`
    if (seen.has(key)) return
    seen.add(key)
    results.push(item)
  }

  const queries: Promise<void>[] = []

  if (types.includes('event')) {
    // Title + notes search
    queries.push(
      Promise.resolve(supabase
        .from('events')
        .select('id, title, notes, start_time')
        .eq('user_id', userId)
        .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
        .order('start_time', { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          for (const e of data ?? []) {
            pushUnique({
              type: 'event',
              id: e.id,
              title: e.title,
              date: e.start_time,
              snippet: e.notes ? e.notes.slice(0, 200) : null,
            })
          }
        }))
    )

    // Attendee email search (cast jsonb to text for partial matching)
    queries.push(
      Promise.resolve(supabase
        .from('events')
        .select('id, title, notes, start_time, attendees')
        .eq('user_id', userId)
        .or(`attendees::text.ilike.${pattern}`)
        .order('start_time', { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          for (const e of data ?? []) {
            const attendees = (e.attendees ?? []) as { email: string; name?: string }[]
            const matchedEmail = attendees.find(
              (a) => a.email?.toLowerCase().includes(q!.toLowerCase())
            )
            pushUnique({
              type: 'event',
              id: e.id,
              title: e.title,
              date: e.start_time,
              snippet: matchedEmail
                ? `Attendee: ${matchedEmail.email}`
                : e.notes ? e.notes.slice(0, 200) : null,
            })
          }
        }))
    )
  }

  if (types.includes('task')) {
    // Title + notes search
    queries.push(
      Promise.resolve(supabase
        .from('tasks')
        .select('id, title, notes, due_date, created_at')
        .eq('user_id', userId)
        .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          for (const t of data ?? []) {
            pushUnique({
              type: 'task',
              id: t.id,
              title: t.title,
              date: t.due_date || t.created_at,
              snippet: t.notes ? t.notes.slice(0, 200) : null,
            })
          }
        }))
    )

    // Tag name search — find tasks via task_tags join
    queries.push(
      Promise.resolve(supabase
        .from('tags')
        .select('name, task_tags(task_id)')
        .ilike('name', pattern)
        .eq('user_id', userId)
        .then(async ({ data: tagMatches }) => {
          const tagTaskIds = tagMatches?.flatMap((t) =>
            ((t.task_tags as TaskTagRef[] | null) ?? []).map((tt) => tt.task_id)
          ) ?? []
          if (tagTaskIds.length === 0) return

          const { data: tagTasks } = await supabase
            .from('tasks')
            .select('id, title, notes, due_date, created_at')
            .in('id', tagTaskIds)
            .eq('user_id', userId)
            .limit(limit)

          for (const t of tagTasks ?? []) {
            const matchedTagName = tagMatches?.find((tag) =>
              ((tag.task_tags as TaskTagRef[] | null) ?? []).some((tt) => tt.task_id === t.id)
            )?.name
            pushUnique({
              type: 'task',
              id: t.id,
              title: t.title,
              date: t.due_date || t.created_at,
              snippet: matchedTagName
                ? `Tag: ${matchedTagName}`
                : t.notes ? t.notes.slice(0, 200) : null,
            })
          }
        }))
    )
  }

  if (types.includes('routine')) {
    queries.push(
      Promise.resolve(supabase
        .from('routines')
        .select('id, title, notes, created_at')
        .eq('user_id', userId)
        .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          for (const r of data ?? []) {
            pushUnique({
              type: 'routine',
              id: r.id,
              title: r.title,
              date: r.created_at,
              snippet: r.notes ? r.notes.slice(0, 200) : null,
            })
          }
        }))
    )
  }

  if (types.includes('booking_link')) {
    queries.push(
      Promise.resolve(supabase
        .from('booking_links')
        .select('id, name, notes, created_at')
        .eq('user_id', userId)
        .or(`name.ilike.${pattern},notes.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          for (const b of data ?? []) {
            pushUnique({
              type: 'booking_link',
              id: b.id,
              title: b.name,
              date: b.created_at,
              snippet: b.notes ? b.notes.slice(0, 200) : null,
            })
          }
        }))
    )
  }

  await Promise.all(queries)

  // Sort by date descending
  results.sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0
    const dateB = b.date ? new Date(b.date).getTime() : 0
    return dateB - dateA
  })

  // Cursor-paginate the merged, deduped results. The per-table `.limit(limit)`
  // above bounds the DB reads; this bounds the returned page. Results can share
  // an id across entity types, so the cursor key is `type:id`.
  return NextResponse.json(paginate(results, searchParams, (r) => `${r.type}:${r.id}`))
}
