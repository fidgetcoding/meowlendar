import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js'

const { getUser, push } = vi.hoisted(() => ({ getUser: vi.fn(), push: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser } }) }))
// A new router object on every render, as some tests' mocks give: the check must not restart.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import { useSessionGuard } from '../use-session-guard'

const user = { id: 'user-1' }
const signedIn = { data: { user }, error: null }
const failed = (error: unknown) => ({ data: { user: null }, error })

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('the session check when the app opens', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getUser.mockReset()
    push.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a signed-in user on the page through failed checks, retrying with backoff', async () => {
    getUser
      .mockResolvedValueOnce(failed(new AuthRetryableFetchError('Failed to fetch', 0)))
      .mockResolvedValueOnce(failed(new AuthRetryableFetchError('Bad Gateway', 502)))
      .mockResolvedValue(signedIn)
    const onSignedIn = vi.fn()
    const { result, rerender } = renderHook(() => useSessionGuard(onSignedIn))
    await flush()
    expect(result.current.unreachable).toBe(true)
    expect(getUser).toHaveBeenCalledTimes(1)

    rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(getUser).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(getUser).toHaveBeenCalledTimes(2)
    expect(result.current.unreachable).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(getUser).toHaveBeenCalledTimes(3)
    expect(result.current.unreachable).toBe(false)
    expect(onSignedIn).toHaveBeenCalledExactlyOnceWith(user)
    expect(push).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(getUser).toHaveBeenCalledTimes(3)
  })

  it('checks again as soon as the browser is back online', async () => {
    getUser.mockResolvedValueOnce(failed(new AuthRetryableFetchError('Failed to fetch', 0))).mockResolvedValue(signedIn)
    const { result } = renderHook(() => useSessionGuard(vi.fn()))
    await flush()
    expect(result.current.unreachable).toBe(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await flush()
    expect(getUser).toHaveBeenCalledTimes(2)
    expect(result.current.unreachable).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it.each([
    ['no session is stored', failed(new AuthSessionMissingError())],
    ['the auth server rejects the session', failed(new AuthApiError('Session not found', 403, 'session_not_found'))],
  ])('sends the user to sign in when %s, once, with no retries', async (_case, answer) => {
    getUser.mockResolvedValue(answer)
    const onSignedIn = vi.fn()
    const { result } = renderHook(() => useSessionGuard(onSignedIn))
    await flush()
    expect(push).toHaveBeenCalledExactlyOnceWith('/login')
    expect(result.current.unreachable).toBe(false)
    expect(onSignedIn).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('stops checking once the page is gone', async () => {
    getUser.mockResolvedValue(failed(new AuthRetryableFetchError('Failed to fetch', 0)))
    const { unmount } = renderHook(() => useSessionGuard(vi.fn()))
    await flush()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })
})
