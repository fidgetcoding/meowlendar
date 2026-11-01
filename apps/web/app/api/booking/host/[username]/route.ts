// SERVICE ROLE: Required. Public endpoint for a host's booking landing page. It
// returns display fields only, and only public links.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { rateLimitAsync } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'

type RouteParams = { params: Promise<{ username: string }> }

const USERNAME_SHAPE = /^[a-z0-9-]{1,63}$/

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!(await rateLimitAsync(`booking-host-ip:${clientIp(request)}`, 60, 60000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { username } = await params
  if (!USERNAME_SHAPE.test(username)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } },
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('username', username)
    .maybeSingle()
  if (!profile) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: links } = await supabase
    .from('booking_links')
    .select('slug, name, duration_minutes')
    .eq('user_id', profile.id)
    .eq('is_public', true)
    .order('created_at', { ascending: true })

  return NextResponse.json({
    host: { display_name: profile.display_name, avatar_url: profile.avatar_url },
    links: links ?? [],
  })
}
