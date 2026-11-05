import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CalendarItem } from '../CalendarItem'
import { getReadableTextColor } from '../event-color'
import type { CalendarItemData } from '../calendar-types'

vi.stubGlobal('React', React)
afterEach(cleanup)

it('chooses dark ink on pale calendar colors and white ink on dark colors', () => {
  expect(getReadableTextColor('#9de1e6')).toBe('#000000')
  expect(getReadableTextColor('#154b87')).toBe('#ffffff')
  expect(getReadableTextColor('#fff')).toBe('#000000')
})

it('draws a pale event as a light tint of its colour with the theme ink, never ink on the raw colour', () => {
  const item = { id: 'event-1', type: 'event', title: 'Calendar event', color: '#9de1e6', startTime: new Date(2026, 10, 5, 8), endTime: new Date(2026, 10, 5, 9) } as CalendarItemData
  render(<CalendarItem item={item} style={{ height: 60 }} />)
  const title = screen.getByText('Calendar event')
  const box = title.closest('[data-calendar-item]') as HTMLElement
  // The box carries the calendar colour for the tint and the left bar; the text sets no colour of
  // its own, so it inherits the theme's ink (dark on light, light on dark).
  expect(box.style.getPropertyValue('--c')).toBe('#9de1e6')
  expect(box.style.backgroundColor).toBe('')
  expect(title.style.color).toBe('')
  expect(screen.getByText('8 - 9 AM').style.color).toBe('')
})

it('keeps at least 4.5:1 contrast across representative Google calendar colors', () => {
  const colors = ['#9de1e6', '#a4bdfc', '#7ae7bf', '#dbadff', '#ff887c', '#fbd75b', '#ffb878', '#dc2127', '#5484ed', '#46d6db', '#000000', '#ffffff']
  for (const color of colors) {
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    const channels = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const l = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    const ratio = getReadableTextColor(color) === '#000000' ? (l + 0.05) / 0.05 : 1.05 / (l + 0.05)
    expect(ratio, color).toBeGreaterThanOrEqual(4.5)
  }
})
