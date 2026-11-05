import * as React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js'
import { mockSupabaseClient } from '@/lib/hooks/__tests__/mock-supabase'

vi.stubGlobal('React', React)
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))

import AppLayout from '../layout'

beforeEach(() => {
  push.mockReset()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AppLayout><div data-testid="calendar" /></AppLayout>
    </QueryClientProvider>,
  )
}

// A dropped connection while the app opened used to send a signed-in user to the login page.
it('keeps a signed-in user in the app when the auth server cannot be reached', async () => {
  mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
  renderApp()
  await act(async () => { await Promise.resolve() })
  expect(push).not.toHaveBeenCalledWith('/login')
  expect(screen.getByTestId('calendar')).toBeTruthy()
  expect(screen.getByText("Can't reach the server right now. Changes will sync when it's back.")).toBeTruthy()
})

it('still sends someone with no session to sign in', async () => {
  mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() })
  renderApp()
  await act(async () => { await Promise.resolve() })
  expect(push).toHaveBeenCalledWith('/login')
})
