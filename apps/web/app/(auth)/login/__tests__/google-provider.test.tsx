import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('React', React)

const signInWithOAuth = vi.fn()
const signInWithPassword = vi.fn()
const getSession = vi.fn()
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOAuth, signInWithPassword, getSession } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPageInner from '../page'

let queryClient = new QueryClient()
/** The page as the app renders it, inside the shared query cache. */
function LoginPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <LoginPageInner />
    </QueryClientProvider>
  )
}
import { resetGoogleSignInCheck } from '@/lib/auth/google-provider'

const SETTINGS = 'http://127.0.0.1:54321/auth/v1/settings'

/**
 * Waits for the click's sign-in to finish. Left running, it ended after the test, where an
 * unanswered mock made it throw outside any test.
 */
async function oauthSettled() {
  await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
  await act(async () => {
    await signInWithOAuth.mock.results[0]!.value
  })
}

function answer(body: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: ok ? 200 : 500 }))
}

// On an install without Google configured, the button used to send people to Supabase's raw JSON
// error ("Unsupported provider: provider is not enabled").
describe('Continue with Google', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set per test: restoreAllMocks() in afterEach clears a mock's answer.
    signInWithOAuth.mockResolvedValue({ data: {}, error: null })
    resetGoogleSignInCheck()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('stays clickable with a pointer to Setup step 7 when Google is not set up', async () => {
    const fetchSpy = answer({ external: { google: false, email: true } })
    render(<LoginPage />)
    await waitFor(() => expect(screen.getByText(/google sign-in works once you finish/i)).toBeTruthy())
    const button = screen.getByRole('button', { name: /continue with google/i })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('link', { name: 'Setup step 7' }).getAttribute('href')).toBe('https://meowlendar.com/setup/')
    expect(fetchSpy).toHaveBeenCalledWith(SETTINGS, { headers: { apikey: 'anon-key' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clicking it then shows the same message as a notice, and never leaves the page', async () => {
    answer({ external: { google: false } })
    render(<LoginPage />)
    await waitFor(() => expect(screen.getByText(/google sign-in works once you finish/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toBe('Google sign-in works once you finish Setup step 7.')
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: /continue with google/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a click before the check finishes still never reaches Supabase when Google is off', async () => {
    answer({ external: { google: false } })
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/setup step 7/i)
    expect(signInWithOAuth).not.toHaveBeenCalled()
  })

  it('works as before when Google is set up', async () => {
    const fetchSpy = answer({ external: { google: true } })
    render(<LoginPage />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const button = screen.getByRole('button', { name: /continue with google/i })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/setup step 7/i)).toBeNull()
    fireEvent.click(button)
    await oauthSettled()
    expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['the settings call fails', () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))],
    ['the settings call errors', () => answer({}, false)],
  ])('falls back to today\'s behaviour when %s', async (_label, mock) => {
    const fetchSpy = mock()
    render(<LoginPage />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(SETTINGS, expect.anything()))
    const button = screen.getByRole('button', { name: /continue with google/i })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/setup step 7/i)).toBeNull()
    fireEvent.click(button)
    await oauthSettled()
  })

  it('checks once per page load', async () => {
    const fetchSpy = answer({ external: { google: true } })
    const settingsCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url) === SETTINGS).length
    const first = render(<LoginPage />)
    await waitFor(() => expect(settingsCalls()).toBe(1))
    first.unmount()
    render(<LoginPage />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(settingsCalls()).toBe(1)
  })
})

// Local setup makes demo@meowlendar.com; the card offers it only on installs that have it.
describe('the demo account hint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGoogleSignInCheck()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function demo(available: boolean) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      new Response(JSON.stringify(String(url) === '/api/demo-available' ? { available } : { external: { google: true } }), { status: 200 }),
    )
  }

  it('offers the demo account, and "Use demo" fills both fields', async () => {
    demo(true)
    render(<LoginPage />)
    expect((await screen.findByText(/just looking\? sign in with demo@meowlendar\.com \/ meowlendar\./i))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use demo' }))
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('demo@meowlendar.com')
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('meowlendar')
    expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeTruthy()
  })

  it('says nothing about a demo on an install without one', async () => {
    const fetchSpy = demo(false)
    render(<LoginPage />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/demo-available'))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByText(/just looking/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use demo' })).toBeNull()
  })
})

// Twice in 21 tries the week was empty right after signing in: the first queries went out before
// the session was in place (row-level security answers those with no rows) or an empty answer
// from before sign-in stayed cached.
describe('signing in with email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetGoogleSignInCheck()
    queryClient = new QueryClient()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('goes in only once the session is there, with nothing cached from before', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    // The client takes a moment to hold the new session.
    getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: 't' } } })
    queryClient.setQueryData(['events', 'list', { start: '2026-11-01' }], [])

    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'demo@meowlendar.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'meowlendar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with email' }))

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
    expect(getSession).toHaveBeenCalledTimes(3)
    expect(getSession.mock.invocationCallOrder.at(-1)!).toBeLessThan(router.replace.mock.invocationCallOrder[0]!)
    expect(queryClient.getQueryData(['events', 'list', { start: '2026-11-01' }])).toBeUndefined()
    expect(router.refresh).toHaveBeenCalled()
  })
})
