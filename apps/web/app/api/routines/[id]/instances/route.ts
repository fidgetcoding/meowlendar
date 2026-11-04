import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../../../lib/auth/helpers'
import { RRule } from 'rrule'
import { readAll } from '@/lib/read-all'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id: routineId } = await params
  const { searchParams } = request.nextUrl

  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json(
      { error: 'Missing required query parameters: start, end' },
      { status: 400 }
    )
  }

  const startDate = new Date(start + 'T00:00:00Z')
  const endDate = new Date(end + 'T23:59:59Z')

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json(
      { error: 'Invalid date format. Use YYYY-MM-DD.' },
      { status: 400 }
    )
  }

  // Fetch the routine to verify ownership and get recurrence_rule
  const { data: routine, error: routineError } = await supabase
    .from('routines')
    .select('*')
    .eq('id', routineId)
    .eq('user_id', userId)
    .single()

  if (routineError || !routine) {
    return NextResponse.json(
      { error: 'Routine not found' },
      { status: 404 }
    )
  }

  // Fetch existing instance rows for this date range
  const { data: existingInstances, error: instancesError } = await readAll(supabase
    .from('routine_instances')
    .select('*')
    .eq('routine_id', routineId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true }).order('id'))

  if (instancesError) {
    return NextResponse.json(
      { error: 'Failed to fetch routine instances' },
      { status: 500 }
    )
  }

  // Build a set of dates that already have instance rows
  const existingDates = new Set(
    (existingInstances ?? []).map((inst: { date: string }) => inst.date)
  )

  // Expand the rrule to find all expected dates in range
  let rrule: RRule
  try {
    rrule = RRule.fromString(routine.recurrence_rule)
    if (rrule.options.interval <= 0 || (rrule.options.count !== null && rrule.options.count <= 0)) {
      throw new Error('Invalid recurrence interval/count')
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid recurrence rule on routine' },
      { status: 500 }
    )
  }

  // Bound work before RRule materializes the entire requested window. Report
  // overflow rather than returning an apparently complete, truncated response.
  let overflow = false
  const occurrences = rrule.between(startDate, endDate, true, (_date, index) => {
    if (index >= 10000) { overflow = true; return false }
    return true
  })
  if (overflow) {
    return NextResponse.json({ error: 'Too many routine occurrences; request a smaller date range.' }, { status: 400 })
  }

  // Generate pending instances for dates that match the rrule but have no row
  const generatedInstances = occurrences
    .map((date) => {
      const dateStr = date.toISOString().split('T')[0]!
      if (existingDates.has(dateStr)) return null
      return {
        id: null,
        routine_id: routineId,
        date: dateStr,
        status: 'pending',
        completed_at: null,
        override_start_time: null,
        override_end_time: null,
        override_title: null,
      }
    })
    .filter(Boolean)

  // Merge and sort by date
  const allInstances = [...(existingInstances ?? []), ...generatedInstances]
  allInstances.sort((a, b) => {
    if (!a || !b) return 0
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  })

  return NextResponse.json(allInstances)
}
