import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { optionalEnv } from '@/lib/env'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!existingProfile) {
          const username =
            user.user_metadata?.name
              ?.toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .slice(0, 20) ||
            user.email?.split('@')[0]?.replace(/[^a-z0-9]/g, '') ||
            user.id.slice(0, 8)

          await supabase.from('profiles').insert({
            id: user.id,
            username,
            display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
            avatar_url: user.user_metadata?.avatar_url || null,
          })
        }

        // Supabase Auth is login-only. Calendar access is a separate OAuth flow
        // (never provider_token). A user with no connected Google account gets
        // sent straight into the Connect flow so the app has calendars to work
        // with. The session cookies set above ride along on this redirect. An
        // email sign-up on a deployment without Google stays in the app rather
        // than landing on the Connect route's "not configured" error.
        const { count } = await supabase
          .from('google_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)

        const googleConfigured =
          optionalEnv('GOOGLE_CLIENT_ID') && optionalEnv('GOOGLE_CLIENT_SECRET')

        if (googleConfigured && (!count || count === 0)) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin
          return NextResponse.redirect(`${appUrl}/api/google/connect`)
        }
      }

      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
