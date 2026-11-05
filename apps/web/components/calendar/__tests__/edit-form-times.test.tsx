import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ItemEditForm } from '../ItemEditForm'

vi.stubGlobal('React', React)
afterEach(cleanup)

// The form's time fields are wall-clock in the user's zone. Save must send an unambiguous instant:
// an offset-less "2026-11-05T14:00:00" is read by Postgres as UTC, which moved a 2 PM event in
// New York to 9 AM.
function saveUnchanged(initialType: 'event' | 'task', initialData: Record<string, unknown>) {
  const onSave = vi.fn()
  render(
    <ItemEditForm mode="edit" initialType={initialType} initialData={{ title: 'Keep me', ...initialData }} calendars={[]} availableTags={[]} onSave={onSave} onClose={vi.fn()} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledOnce()
  return onSave.mock.calls[0]![1] as Record<string, unknown>
}

it('saves an event at exactly the instant it opened with', () => {
  const data = saveUnchanged('event', { start_time: '2026-11-05T19:00:00.000Z', end_time: '2026-11-05T20:00:00.000Z' })
  expect(data.start_time).toBe('2026-11-05T19:00:00.000Z')
  expect(data.end_time).toBe('2026-11-05T20:00:00.000Z')
})

it("saves a task's calendar slot at exactly the instant it opened with", () => {
  const data = saveUnchanged('task', { scheduled_start: '2026-11-05T19:30:00.000Z', scheduled_end: '2026-11-05T20:15:00.000Z' })
  expect(data.scheduled_start).toBe('2026-11-05T19:30:00.000Z')
  expect(data.scheduled_end).toBe('2026-11-05T20:15:00.000Z')
})

it('keeps an all-day event on its calendar date', () => {
  const data = saveUnchanged('event', { is_all_day: true, start_time: '2026-11-05T00:00:00+00:00', end_time: '2026-11-06T00:00:00+00:00' })
  expect(data.start_time).toBe('2026-11-05T00:00:00.000Z')
  expect(data.end_time).toBe('2026-11-06T00:00:00.000Z')
})

// All-day events store an exclusive end, like Google: one day D is D 00:00Z to D+1 00:00Z. The form
// shows the last day inclusively. Saving start = end made a zero-length event the grid never drew.
it('creates a one-day all-day event as a full day', () => {
  const onSave = vi.fn()
  render(
    <ItemEditForm mode="create" initialType="event" initialData={{ title: 'Holiday', start_time: new Date(2026, 10, 5, 9).toISOString(), end_time: new Date(2026, 10, 5, 10).toISOString() }} calendars={[]} availableTags={[]} onSave={onSave} onClose={vi.fn()} />,
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(onSave.mock.calls[0]![1]).toMatchObject({ is_all_day: true, start_time: '2026-11-05T00:00:00.000Z', end_time: '2026-11-06T00:00:00.000Z' })
})

it('shows a stored all-day end as the last day, and keeps a multi-day range on save', () => {
  const onSave = vi.fn()
  render(
    <ItemEditForm mode="edit" initialType="event" initialData={{ title: 'Trip', is_all_day: true, start_time: '2026-11-05T00:00:00+00:00', end_time: '2026-11-08T00:00:00+00:00' }} calendars={[]} availableTags={[]} onSave={onSave} onClose={vi.fn()} />,
  )
  expect(screen.getByDisplayValue('2026-11-07')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave.mock.calls[0]![1]).toMatchObject({ is_all_day: true, start_time: '2026-11-05T00:00:00.000Z', end_time: '2026-11-08T00:00:00.000Z' })
})

it('repairs an all-day event saved with no length when it is edited', () => {
  const data = saveUnchanged('event', { is_all_day: true, start_time: '2026-11-05T00:00:00+00:00', end_time: '2026-11-05T00:00:00+00:00' })
  expect(data).toMatchObject({ is_all_day: true, start_time: '2026-11-05T00:00:00.000Z', end_time: '2026-11-06T00:00:00.000Z' })
})
