import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/lib/hooks/__tests__/mock-supabase'

vi.stubGlobal('React', React)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))

import AppLayout from '../layout'
import { useUIStore } from '@/lib/stores/ui-store'

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

// The booking panel used to open on the right; like Morgen it now sits beside the ribbon, with the
// calendar to its right. The task panel keeps the right-hand side.
it('opens the booking panel on the left, between the ribbon and the calendar', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AppLayout><div data-testid="calendar" /></AppLayout>
    </QueryClientProvider>,
  )
  const ribbon = screen.getByRole('navigation', { name: 'Main navigation' })
  const calendar = screen.getByTestId('calendar')
  // The task panel starts open, on the right of the calendar.
  expect(follows(calendar, screen.getByRole('complementary', { name: 'Tasks' }))).toBe(true)

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Booking' })) })
  const booking = screen.getAllByRole('complementary', { name: 'Booking' })[0]!
  expect(follows(ribbon, booking)).toBe(true)
  expect(follows(booking, calendar)).toBe(true)
  expect(booking.className).toContain('meow-bpanel')

  // The ribbon marks Booking while its panel is open, and pressing it again closes the panel.
  const nav = within(ribbon)
  expect(nav.getByRole('button', { name: 'Booking' }).getAttribute('aria-current')).toBe('page')
  expect(nav.getByRole('button', { name: 'Calendar' }).getAttribute('aria-current')).toBeNull()
  await act(async () => { fireEvent.click(nav.getByRole('button', { name: 'Booking' })) })
  expect(screen.queryAllByRole('complementary', { name: 'Booking' })).toHaveLength(0)
  expect(nav.getByRole('button', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page')
})
