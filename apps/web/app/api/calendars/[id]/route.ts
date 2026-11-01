import { NextRequest, NextResponse, after } from 'next/server'
import { pullChanges } from '@/lib/google/sync'
import { z } from 'zod'
import { authenticate, isAuthError, validationError } from '@/lib/auth/helpers'
import { disconnectGoogleAccount } from '@/lib/google/oauth'
import { updateGoogleCalendarColor } from '@/lib/google/calendar'

const patchSchema = z
  .object({
    is_active: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex string')
      .optional(),
  })
  .refine((v) => v.is_active !== undefined || v.color !== undefined || v.name !== undefined, {
    message: 'Provide at least one of is_active, color, or name',
  })

/**
 * PATCH /api/calendars/:id — toggle is_active and/or change colour. A colour
 * change is also pushed to Google (calendarList.update); a Google failure is
 * stored locally and silently swallowed (spec #49a).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return validationError(parsed.error.issues)
  }

  const { data: calendar, error: calError } = await supabase
    .from('calendars')
    .select('id, source, google_account_id, google_calendar_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (calError || !calendar) {
    return NextResponse.json({ error: 'Calendar not found' }, { status: 404 })
  }

  // A Google calendar's name belongs to Google and comes back on the next sync.
  if (parsed.data.name !== undefined && calendar.source !== 'local') {
    return NextResponse.json(
      { error: 'Only local calendars can be renamed here' },
      { status: 409 },
    )
  }

  const updates: { is_active?: boolean; color?: string; name?: string } = {}
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.color !== undefined) {
    updates.color = parsed.data.color
    if (calendar.google_account_id && calendar.google_calendar_id) {
      try {
        await updateGoogleCalendarColor(
          calendar.google_account_id,
          calendar.google_calendar_id,
          parsed.data.color
        )
      } catch (err) {
        // Local colour is authoritative for rendering — swallow the Google error.
        console.error('[calendars/PATCH] Google colour push failed (stored locally):', err)
      }
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('calendars')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (updateError || !updated) {
    return NextResponse.json(
      { error: 'Failed to update calendar' },
      { status: 500 }
    )
  }

  // Turned back on: bring it up to date now rather than at the next scheduled sync.
  if (parsed.data.is_active === true && calendar.google_account_id) {
    const accountId = calendar.google_account_id
    after(() => pullChanges(accountId).catch((err) => {
      console.error('[calendars/PATCH] sync after enabling failed:', err)
    }))
  }

  return NextResponse.json(updated)
}

/**
 * DELETE /api/calendars/:id — a local calendar is deleted with its events, and the
 * user's last local calendar stays so events always have somewhere to go. For a
 * Google calendar this disconnects the google_account that OWNS it (spec semantics:
 * disconnect account), which cascades to all its calendars + events. Ownership
 * verified under RLS first.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { id } = await params

  const { data: calendar, error: calError } = await supabase
    .from('calendars')
    .select('source, google_account_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (calError || !calendar) {
    return NextResponse.json({ error: 'Calendar not found' }, { status: 404 })
  }

  if (calendar.source === 'local') {
    const { count } = await supabase
      .from('calendars')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'local')
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'You need at least one local calendar' },
        { status: 409 },
      )
    }
    const { error } = await supabase.from('calendars').delete().eq('id', id).eq('user_id', userId)
    if (error) {
      return NextResponse.json({ error: 'Failed to delete calendar' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  try {
    await disconnectGoogleAccount(calendar.google_account_id)
  } catch (err) {
    console.error('[calendars/DELETE] teardown failed:', err)
    return NextResponse.json(
      { error: 'Failed to disconnect account' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
