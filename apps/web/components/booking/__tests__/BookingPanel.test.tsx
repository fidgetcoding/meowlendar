import * as React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.stubGlobal('React', React)
vi.mock('@/lib/hooks/use-profile', () => ({ useProfile: () => ({ data: { username: 'nate' } }) }))

import { BookingPanel } from '../BookingPanel'

const links = [
  { id: 'l1', name: 'Intro call', slug: 'intro', duration_minutes: 30, is_public: true },
  { id: 'l2', name: 'Office hours', slug: 'office', duration_minutes: 45, is_public: true },
  { id: 'l3', name: 'Investor chat', slug: 'investors', duration_minutes: 60, is_public: false },
]
const confirmed = [{ booking_link_id: 'l1' }, { booking_link_id: 'l1' }, { booking_link_id: 'l3' }]

function renderPanel(onNewLink = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <BookingPanel onNewLink={onNewLink} />
    </QueryClientProvider>,
  )
  return onNewLink
}

describe('the booking panel', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const body = url.includes('/api/booking-links') ? links : url.includes('status=confirmed') ? confirmed : []
      return new Response(JSON.stringify(body), { status: 200 })
    })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('heads with "Booking page", a + for a new link, and the link to your booking page', async () => {
    const onNewLink = renderPanel()
    expect(screen.getByRole('heading', { name: 'Booking page' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New booking link' }))
    expect(onNewLink).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: 'Link to your booking page' }).getAttribute('href')).toBe(`${window.location.origin}/u/nate`)
  })

  it('lists public links with their length and how many are booked', async () => {
    renderPanel()
    const list = await screen.findByRole('region', { name: 'Public links' })
    await waitFor(() => expect(within(list).getByText('2 booked')).toBeTruthy())
    expect(within(list).getByText('Intro call')).toBeTruthy()
    expect(within(list).getByText('30 min')).toBeTruthy()
    expect(within(list).getByText('Office hours')).toBeTruthy()
    expect(within(list).getByText('0 booked')).toBeTruthy()
  })

  it('keeps private links folded under "Private links (N)" until opened', async () => {
    renderPanel()
    const toggle = await screen.findByRole('button', { name: /private links \(1\)/i })
    expect(screen.queryByText('Investor chat')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Investor chat')).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})
