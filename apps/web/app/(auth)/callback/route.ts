import { NextRequest, NextResponse, after } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { safeInternalPath } from '@/lib/safe-path'
import { getGoogleIdentity, saveGoogleAccount } from '@/lib/google/oauth'
import { pullChanges } from '@/lib/google/sync'
import { registerAccountWebhook } from '@/lib/google/webhooks'

type PendingCookie = { name: string; value: string; options: Record<string, unknown> }

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeInternalPath(searchParams.get('next')) ?? '/'

  if (code) {
    const cookieStore = await cookies()
    let pendingCookies: PendingCookie[] = []
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          // Do not send the intermediate session to the browser: it may contain
          // Google provider tokens. Only the sanitized session is committed below.
          setAll(cookiesToSet: PendingCookie[]) { pendingCookies = cookiesToSet },
        },
      },
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    const session = data?.session
    if (!error && session) {
      const providerToken = session.provider_token
      const providerRefreshToken = session.provider_refresh_token

      if (providerToken || providerRefreshToken) {
        pendingCookies = []
        const { error: sanitizeError } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })
        // A failed sanitizer must never send the provider-bearing cookies.
        if (sanitizeError || !pendingCookies.some(({ name, value }) => name.includes('auth-token') && value)) return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
      }
      pendingCookies.forEach(({ name, value, options }) => cookieStore.set(name, value, options))

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: existingProfile } = await supabase
          .from('profiles').select('id').eq('id', user.id).single()

        if (!existingProfile) {
          const username =
            user.user_metadata?.name?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) ||
            user.email?.split('@')[0]?.replace(/[^a-z0-9]/g, '') || user.id.slice(0, 8)
          await supabase.from('profiles').insert({
            id: user.id,
            username,
            display_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
            avatar_url: user.user_metadata?.avatar_url || null,
          })
        }

        if (user.app_metadata?.provider === 'google' && providerToken) {
          try {
            const identity = await getGoogleIdentity(providerToken)
            if (!identity.emailVerified || !user.email || identity.email.toLowerCase() !== user.email.toLowerCase()) {
              throw new Error('Google identity does not match the signed-in user')
            }
            const accountId = await saveGoogleAccount(user.id, {
              access_token: providerToken,
              refresh_token: providerRefreshToken ?? undefined,
              // Google access tokens are normally valid for an hour. Refresh
              // conservatively before then rather than guessing a later expiry.
              expires_in: 45 * 60,
              email: identity.email,
            })
            const first = await pullChanges(accountId, { deadlineMs: Date.now() + 6000 })
            if (!first.complete) {
              after(() => pullChanges(accountId, { waitForLeaseMs: 10_000 }).catch(() => {
                console.error('[auth/callback] background calendar sync failed')
              }))
            }
            after(() => registerAccountWebhook(accountId).catch(() => {
              console.error('[auth/callback] calendar webhook registration failed')
            }))
          } catch {
            // Login remains usable; the app explains the calendar problem and
            // keeps retrying. Never log provider responses or token values.
            const failed = new URL(next, origin)
            failed.searchParams.set('google_sync', 'failed')
            return NextResponse.redirect(failed)
          }
        } else if (user.app_metadata?.provider === 'google' && !providerToken) {
          const { count, error: countError } = await supabase
            .from('google_accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          if (countError || !count) {
            const failed = new URL(next, origin)
            failed.searchParams.set('google_sync', 'failed')
            return NextResponse.redirect(failed)
          }
        }
      }

      const base = process.env.NODE_ENV === 'development' ? origin : process.env.NEXT_PUBLIC_APP_URL || origin
      return NextResponse.redirect(new URL(next, base))
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
