import * as React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Profile } from '@poolendar/types'

const mocks = vi.hoisted(() => ({ update: vi.fn(), signOut: vi.fn() }))
vi.stubGlobal('React', React)
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ accounts: [], local_calendars: [] }) })))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { email: 'test@example.test' } } }), signOut: mocks.signOut },
  from: (table: string) => table === 'profiles'
    ? { update: (data: unknown) => ({ eq: async () => { return mocks.update(data) ?? { error: null } } }) }
    : { select: () => ({ order: async () => ({ data: [] }) }) },
}) }))
import { SettingsModal } from '../SettingsModal'
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('saves edited profile fields when closing without a Save button', async () => {
  const profile = { id: 'test-user', settings: {}, display_name: 'Old', username: 'test', company: null } as Profile
  render(<SettingsModal open onOpenChange={vi.fn()} profile={profile} onProfileUpdate={vi.fn()} initialTab="profile" />)
  const input = await screen.findByDisplayValue('Old')
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Sign Out' }).length).toBeGreaterThan(0)
  fireEvent.change(input, { target: { value: 'New name' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Close settings' })[1])
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'New name' })))
})

it('keeps settings open and offers a retry if saving fails', async () => {
  mocks.update.mockReturnValueOnce({ error: new Error('offline') })
  const onOpenChange = vi.fn()
  const profile = { id: 'test-user', settings: {}, display_name: 'Old', username: 'test', company: null } as Profile
  render(<SettingsModal open onOpenChange={onOpenChange} profile={profile} onProfileUpdate={vi.fn()} initialTab="profile" />)
  fireEvent.change(await screen.findByDisplayValue('Old'), { target: { value: 'New name' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Close settings' })[1])
  await screen.findByRole('button', { name: 'Retry save' })
  expect(onOpenChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
})
