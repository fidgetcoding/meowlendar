import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { authenticate, isAuthError, validationError } from '@/lib/auth/helpers'
import { flushTaskSync } from '@/lib/google/task-sync'

const putSchema = z.object({
  calendar_id: z.string().uuid().nullable(),
})

/** Which Google calendar scheduled tasks go to. Null means off. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { data } = await auth.supabase
    .from('profiles')
    .select('settings')
    .eq('id', auth.userId)
    .single()
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  return NextResponse.json({ calendar_id: settings.task_sync_calendar_id ?? null })
}

/** Picks the calendar, or turns this off with null. Mirrored events follow the choice. */
export async function PUT(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth
  const { userId, supabase } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return validationError(parsed.error.issues)
  const { calendar_id: calendarId } = parsed.data

  if (calendarId) {
    const { data: calendar } = await supabase
      .from('calendars')
      .select('id, source, access_role')
      .eq('id', calendarId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!calendar) {
      return NextResponse.json({ error: 'Calendar not found' }, { status: 404 })
    }
    if (calendar.source !== 'google') {
      return NextResponse.json({ error: 'Pick a Google calendar' }, { status: 422 })
    }
    if (calendar.access_role !== 'owner' && calendar.access_role !== 'writer') {
      return NextResponse.json({ error: 'That calendar is read-only' }, { status: 422 })
    }
  }

  const { data: profile } = await supabase.from('profiles').select('settings').eq('id', userId).single()
  const settings = { ...((profile?.settings ?? {}) as Record<string, unknown>), task_sync_calendar_id: calendarId }
  const { error } = await supabase.from('profiles').update({ settings }).eq('id', userId)
  if (error) {
    return NextResponse.json({ error: 'Failed to save the setting' }, { status: 500 })
  }

  after(() => flushTaskSync({ userId }).catch((err) => {
    console.error('[tasks/google-sync] sync failed, the scheduled job will retry:', err)
  }))

  return NextResponse.json({ calendar_id: calendarId })
}
