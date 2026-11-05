import * as React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CalendarsTab } from '../CalendarsTab'
import type { GoogleAccount } from '@poolendar/types'

vi.stubGlobal('React', React)
afterEach(cleanup)

it('shows progress and prevents duplicate syncs until the request finishes', async () => {
  let finish!: () => void
  const onResync = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const account = { id: 'account-1', email: 'test@example.test', last_synced_at: null } as GoogleAccount
  render(<CalendarsTab googleAccounts={[account]} calendars={[]} onResync={onResync} onConnect={vi.fn()} onDisconnect={vi.fn()} onToggleCalendar={vi.fn()} onCreateLocal={vi.fn()} onRenameLocal={vi.fn()} onDeleteLocal={vi.fn()} taskSyncCalendarId={null} onTaskSyncChange={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Resync account' }))
  const button = screen.getByRole('button', { name: 'Syncing account' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.querySelector('.animate-spin')).not.toBeNull()
  fireEvent.click(button)
  expect(onResync).toHaveBeenCalledTimes(1)
  await act(async () => { finish() })
  expect((screen.getByRole('button', { name: 'Resync account' }) as HTMLButtonElement).disabled).toBe(false)
})
