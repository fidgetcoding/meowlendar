import { readAll } from '@/lib/read-all'
// Host-facing bookings list (spec #75: GET /api/booking/links/:id/bookings, here
// generalized to the host's whole pool with optional filters). Session or API-key
// auth. This is the canonical replacement for the deleted
// /api/booking-links/[id]/bookings dead-tree route — the booking panel reads it
// to render the pending-approvals queue and recent bookings.
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '../../../../lib/auth/helpers'
import { paginate } from '../../../../lib/pagination'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) return auth

  const { userId, supabase } = auth
  const { searchParams } = request.nextUrl

  const statusFilter = searchParams.get('status') // pending | confirmed | cancelled
  const linkId = searchParams.get('link_id')

  let query = supabase
    .from('bookings')
    .select(
      'id, booking_link_id, booker_name, booker_email, booker_notes, start_time, end_time, status, google_event_id, cancel_token, created_at, updated_at, booking_links!inner(name, slug, duration_minutes)'
    )
    .eq('booking_links.user_id', userId)
    .order('start_time', { ascending: false })

  if (statusFilter) query = query.eq('status', statusFilter)
  if (linkId) query = query.eq('booking_link_id', linkId)

  const { data, error } = await readAll(query.order('id'))
  if (error) {
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }

  return NextResponse.json(paginate(data ?? [], searchParams))
}
