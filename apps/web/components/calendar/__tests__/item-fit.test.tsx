import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CalendarItem } from '../CalendarItem'
import type { CalendarItemData } from '../calendar-types'

vi.stubGlobal('React', React)
afterEach(cleanup)

const task = (minutes: number) => ({
  id: `t-${minutes}`, type: 'task', title: 'Write the launch post for the site', color: '#e8930c',
  startTime: new Date(2026, 10, 5, 14), endTime: new Date(2026, 10, 5, 14, minutes),
  task: { id: `t-${minutes}`, importance: 'normal', status: 'backlog' },
}) as unknown as CalendarItemData

// A 45-minute item at 60px an hour is 43px tall: room for one title line and the time, not two.
// A two-line title pushed the time row 8px out of the box on phones.
it('keeps the title of a short item to one line so its time row fits', () => {
  render(<CalendarItem item={task(45)} style={{ top: 0, height: 43 }} />)
  const box = screen.getByText('Write the launch post for the site').closest('[data-calendar-item]')!
  expect(box.className).toContain('is-oneline')
  expect(screen.getByText('2 - 2:45 PM')).toBeTruthy()
})

it('lets a tall item wrap its title to two lines', () => {
  render(<CalendarItem item={task(90)} style={{ top: 0, height: 88 }} />)
  const box = screen.getByText('Write the launch post for the site').closest('[data-calendar-item]')!
  expect(box.className).not.toContain('is-oneline')
})
