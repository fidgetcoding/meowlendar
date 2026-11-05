import * as React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.stubGlobal('React', React)
vi.mock('@/lib/offline/sync', () => ({ drainQueue: vi.fn(async () => ({ succeeded: 0, failed: 0 })) }))

import { OfflineBanner } from '../OfflineBanner'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// While the session check can't reach the server, the user stays and sees the offline strip.
it('shows the offline strip while the server is unreachable, then says it is back', () => {
  const { rerender } = render(<OfflineBanner serverUnreachable />)
  expect(screen.getByRole('status').textContent).toBe("Can't reach the server right now. Changes will sync when it's back.")

  rerender(<OfflineBanner serverUnreachable={false} />)
  expect(screen.getByRole('status').textContent).toBe('Back online. Syncing...')
  act(() => { vi.advanceTimersByTime(3000) })
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows nothing while everything is reachable', () => {
  render(<OfflineBanner />)
  expect(screen.queryByRole('status')).toBeNull()
})
