import { NextRequest, NextResponse, after } from 'next/server'
import { authenticate, isAuthError } from '@/lib/auth/helpers'
import { verifyOAuthState } from '@/lib/google/state'
import { exchangeCodeForTokens, saveGoogleAccount } from '@/lib/google/oauth'
import { pullChanges } from '@/lib/google/sync'
import { registerAccountWebhook } from '@/lib/google/webhooks'

const INLINE_SYNC_MS = 6000

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

function fail(reason: string): NextResponse {
  return NextResponse.redirect(`${appUrl()}/?error=${reason}`)
}

/**
 * Google OAuth callback. Verifies the signed state, exchanges the code, stores
 * the account through the ENCRYPTING path (saveGoogleAccount — never raw tokens
 * to the DB), then kicks off the initial sync and registers push webhooks.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const oauthError = searchParams.get('error')

  if (oauthError) return fail('google_auth_denied')
  if (!code || !state) return fail('missing_params')

  // 1. HMAC-signed state (CSRF: attacker can't forge a state for another user).
  const verified = verifyOAuthState(state)
  if (!verified) return fail('invalid_state')
  const { userId: stateUserId, nonce } = verified

  // 2. Nonce↔cookie binding for the browser GET flow. When the cookie is present
  //    it must match; when absent (JSON/MCP flow completes in a browser that
  //    never got the cookie) we fall back to HMAC + session match below.
  const cookieNonce = request.cookies.get('oauth_state')?.value
  if (cookieNonce && cookieNonce !== nonce) return fail('invalid_state')

  // 3. The completing session must be the same user the state was signed for.
  const auth = await authenticate(request)
  if (isAuthError(auth) || auth.userId !== stateUserId) {
    return fail('session_mismatch')
  }
  const userId = stateUserId

  // 4. Exchange the authorization code for tokens (+ the account email).
  const redirectUri = `${appUrl()}/api/google/callback`
  let tokens
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri)
  } catch (err) {
    console.error('[google/callback] token exchange failed:', err)
    return fail('token_exchange_failed')
  }

  // 5. Persist through the encrypting path. Tokens are AES-GCM encrypted before
  //    they touch the DB; a re-consent without a refresh_token preserves the one
  //    already stored.
  let accountId: string
  try {
    accountId = await saveGoogleAccount(userId, tokens)
  } catch (err) {
    console.error('[google/callback] saveGoogleAccount failed:', err)
    return fail('account_save_failed')
  }

  // 6. First sync, of every calendar on the account. It gets a few seconds inline so
  //    the user lands on a filled calendar; whatever is left finishes after the
  //    redirect, and the scheduled job picks up anything after that.
  try {
    const first = await pullChanges(accountId, { deadlineMs: Date.now() + INLINE_SYNC_MS })
    if (!first.complete) {
      after(() => pullChanges(accountId).catch((err) => {
        console.error('[google/callback] background sync failed (poll will retry):', err)
      }))
    }
  } catch (err) {
    console.error('[google/callback] initial sync failed (poll will retry):', err)
  }

  // 7. Register push webhooks — best-effort; poll fallback covers any gap.
  try {
    await registerAccountWebhook(accountId)
  } catch (err) {
    console.error('[google/callback] webhook registration failed (renewal cron will retry):', err)
  }

  const response = NextResponse.redirect(`${appUrl()}/?google_connected=true`)
  response.cookies.set('oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })

  return response
}
