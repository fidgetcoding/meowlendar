import { describe, expect, it } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, type User } from '@supabase/supabase-js'
import { checkSession, classifySessionCheck, sessionRetryDelayMs } from '../session-check'

// The app used to send anyone whose getUser() came back without a user to the login page, so a
// dropped connection or a busy auth server signed out people who were still signed in.

const user = { id: 'user-1' } as User
const failed = (error: unknown) => ({ data: { user: null }, error })

describe('reading a session check', () => {
  it('keeps a signed-in user', () => {
    expect(classifySessionCheck({ data: { user }, error: null })).toEqual({ kind: 'signed-in', user })
  })

  it.each([
    ['no session is stored', new AuthSessionMissingError()],
    ['the token is rejected (401)', new AuthApiError('invalid JWT', 401, 'bad_jwt')],
    ['the session is gone (403)', new AuthApiError('Session not found', 403, 'session_not_found')],
    ['the user no longer exists (404)', new AuthApiError('User not found', 404, 'user_not_found')],
  ])('signs out when %s', (_case, error) => {
    expect(classifySessionCheck(failed(error))).toEqual({ kind: 'signed-out' })
  })

  it.each([
    ['the network fails', new AuthRetryableFetchError('Failed to fetch', 0)],
    ['the auth server errors (503)', new AuthRetryableFetchError('Service Unavailable', 503)],
    ['the auth server errors (500)', new AuthApiError('Internal error', 500, undefined)],
    ['the request times out (408)', new AuthApiError('Request Timeout', 408, undefined)],
    ['the auth server is rate limiting (429)', new AuthApiError('Too many requests', 429, 'over_request_rate_limit')],
    ['the answer is unreadable', new AuthUnknownError('Unexpected token', new SyntaxError('bad json'))],
  ])('keeps the user when %s', (_case, error) => {
    expect(classifySessionCheck(failed(error))).toEqual({ kind: 'unreachable' })
  })

  it('keeps the user when getUser itself throws', async () => {
    const auth = { getUser: async () => { throw new TypeError('Load failed') } }
    expect(await checkSession(auth as never)).toEqual({ kind: 'unreachable' })
  })

  it('backs off 1s, 2s, 4s and caps at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(sessionRetryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })
})
