import { readAll } from '@/lib/read-all'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../lib/auth/helpers'
import { paginate } from '../../../lib/pagination'
import { mergeCopies, type CopyFacts } from '../../../lib/event-merge'


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
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 50)
  const pattern = `%${safeQ}%`

  const seen = new Set<string>()
  const results: { type: string; id: string; title: string; date: string | null; snippet: string | null }[] = []
  // What tells copies of one meeting apart, by event id.
  const eventFacts = new Map<string, CopyFacts>()
  const noteFacts = (e: { id: string; calendar_id: string; ical_uid: string | null; title: string; start_time: string; end_time: string }) =>
    eventFacts.set(e.id, { calendarId: e.calendar_id, icalUid: e.ical_uid, title: e.title, start: Date.parse(e.start_time), end: Date.parse(e.end_time) })

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
      readAll(supabase
        .from('events')
        .select('id, title, notes, start_time, end_time, calendar_id, ical_uid')
        .eq('user_id', userId)
        .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
        .order('start_time', { ascending: false })
        .order('id'))
        .then(({ data, error }) => {
          if (error) throw error
          for (const e of data ?? []) {
            noteFacts(e)
            pushUnique({
              type: 'event',
              id: e.id,
              title: e.title,
              date: e.start_time,
              snippet: e.notes ? e.notes.slice(0, 200) : null,
            })
          }
        })
    )

    // Attendee email search (cast jsonb to text for partial matching)
    queries.push(
      readAll(supabase
        .from('events')
        .select('id, title, notes, start_time, end_time, calendar_id, ical_uid, attendees')
        .eq('user_id', userId)
        .ilike('attendee_search_text', pattern)
        .order('start_time', { ascending: false })
        .order('id'))
        .then(({ data, error }) => {
          if (error) throw error
          for (const e of data ?? []) {
            noteFacts(e)
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
        })
    )
  }

  if (types.includes('task')) {
    // Title + notes search
    queries.push(
      readAll(supabase
        .from('tasks')
        .select('id, title, notes, due_date, created_at')
        .eq('user_id', userId)
        .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .order('id'))
        .then(({ data, error }) => {
          if (error) throw error
          for (const t of data ?? []) {
            pushUnique({
              type: 'task',
              id: t.id,
              title: t.title,
              date: t.due_date || t.created_at,
              snippet: t.notes ? t.notes.slice(0, 200) : null,
            })
          }
        })
    )

    // Join the matching tag instead of building an unbounded IN() URL.
    queries.push(readAll(supabase.from('tasks')
      .select('id, title, notes, due_date, created_at, task_tags!inner(tags!inner(name))')
      .eq('user_id', userId).ilike('task_tags.tags.name', pattern).order('id'))
      .then(({ data, error }) => {
        if (error) throw error
        for (const task of data ?? []) {
          const tags = task.task_tags as unknown as { tags: { name: string } }[]
          pushUnique({ type: 'task', id: task.id, title: task.title,
            date: task.due_date || task.created_at,
            snippet: tags[0]?.tags.name ? `Tag: ${tags[0].tags.name}` : task.notes?.slice(0, 200) ?? null })
        }
      }))
  }

  if (types.includes('routine')) {
    queries.push(
      readAll(supabase
        .from('routines')
        .select('id, title, notes, created_at')
        .eq('user_id', userId)
        .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .order('id'))
        .then(({ data, error }) => {
          if (error) throw error
          for (const r of data ?? []) {
            pushUnique({
              type: 'routine',
              id: r.id,
              title: r.title,
              date: r.created_at,
              snippet: r.notes ? r.notes.slice(0, 200) : null,
            })
          }
        })
    )
  }

  if (types.includes('booking_link')) {
    queries.push(
      readAll(supabase
        .from('booking_links')
        .select('id, name, notes, created_at')
        .eq('user_id', userId)
        .or(`name.ilike.${pattern},notes.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .order('id'))
        .then(({ data, error }) => {
          if (error) throw error
          for (const b of data ?? []) {
            pushUnique({
              type: 'booking_link',
              id: b.id,
              title: b.name,
              date: b.created_at,
              snippet: b.notes ? b.notes.slice(0, 200) : null,
            })
          }
        })
    )
  }

  try { await Promise.all(queries) }
  catch { return NextResponse.json({ error: 'Failed to search' }, { status: 500 }) }

  // A meeting on several calendars or accounts is one result, as on the grid.
  if (searchParams.get('merge') !== 'false') {
    const kept = mergeCopies(results, (r) => (r.type === 'event' ? eventFacts.get(r.id) ?? null : null), () => 0).shown
    results.splice(0, results.length, ...kept)
  }

  // Sort by date descending
  results.sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0
    const dateB = b.date ? new Date(b.date).getTime() : 0
    return dateB - dateA || `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)
  })

  // Apply the public page only after all sources have been read and merged.
  const page = new URLSearchParams(searchParams)
  if (searchParams.has('limit')) page.set('limit', String(limit))
  return NextResponse.json(paginate(results, page, (r) => `${r.type}:${r.id}`))
}
