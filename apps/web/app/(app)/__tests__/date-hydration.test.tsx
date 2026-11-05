import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { act } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import '@/lib/hooks/__tests__/mock-supabase'

vi.stubGlobal('React', React)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))

import AppPage from '../page'
import { UndoProvider } from '@/lib/undo/undo-context'
import { useCalendarStore } from '@/lib/stores/calendar-store'

function App() {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <UndoProvider>
        <AppPage />
      </UndoProvider>
    </QueryClientProvider>
  )
}

/** Run with the clock (Date only) and the calendar's day set to `when`, as that machine sees it. */
function at(when: Date) {
  vi.setSystemTime(when)
  useCalendarStore.setState({ selectedDate: format(when, 'yyyy-MM-dd') })
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

// A server past midnight (here a day ahead) rendered "today" and the week from its own date, and
// the browser hydrated with its own: React #418 on every load. The dated views now draw only once
// the browser has mounted.
it.each([
  ['the server is a day ahead', new Date(2026, 10, 6, 0, 30), new Date(2026, 10, 5, 19, 30)],
  ['the server is a day behind, across a week boundary', new Date(2026, 10, 7, 23, 30), new Date(2026, 10, 8, 4, 30)],
])('hydrates without a mismatch when %s', async (_label, serverNow, browserNow) => {
  vi.useFakeTimers({ toFake: ['Date'] })

  at(serverNow)
  const html = renderToString(<App />)
  // Nothing dated in the server's HTML.
  expect(html).not.toContain('meow-dh')
  expect(html).not.toContain(format(serverNow, 'MMM d'))

  at(browserNow)
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  const recoverable = vi.fn()
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  await act(async () => {
    root = hydrateRoot(container, <App />, { onRecoverableError: recoverable })
  })

  expect(recoverable).not.toHaveBeenCalled()
  expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydrat/i)
  consoleError.mockRestore()
  // The browser's own day is today in the week it draws.
  expect(container.querySelector('.meow-dh.is-today')?.textContent).toContain(String(browserNow.getDate()))
})
