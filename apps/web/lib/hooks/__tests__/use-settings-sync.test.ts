import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSettingsSync } from '../use-settings-sync'
import { useCalendarStore } from '@/lib/stores/calendar-store'

const { mutate } = vi.hoisted(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  } })
  return { mutate: vi.fn() }
})
vi.mock('../use-profile', () => ({
  useProfile: () => ({ data: { settings: {} } }),
  // React Query returns a fresh result object on each render, with a stable mutate.
  useUpdateProfile: () => ({ mutate }),
}))
afterEach(() => vi.useRealTimers())

it('persists a pending settings change after an unrelated rerender', () => {
  vi.useFakeTimers()
  const { rerender, unmount } = renderHook(() => useSettingsSync())
  act(() => useCalendarStore.setState({ showWeekends: !useCalendarStore.getState().showWeekends }))
  const expected = useCalendarStore.getState().showWeekends
  act(() => vi.advanceTimersByTime(400))
  rerender()
  act(() => vi.advanceTimersByTime(400))
  expect(mutate).toHaveBeenCalledTimes(1)
  expect(mutate).toHaveBeenCalledWith({ settings: expect.objectContaining({ show_weekends: expected }) })
  unmount()
})
