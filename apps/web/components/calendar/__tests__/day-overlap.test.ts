import { expect, it } from 'vitest'
import { computeOverlapLayout } from '../DayColumn'
import type { CalendarItemData } from '../calendar-types'

it('places short events side by side when their minimum rendered heights overlap', () => {
  const item = (id: string, minute: number) => ({
    id,
    startTime: new Date(2026, 10, 5, 10, minute),
    endTime: new Date(2026, 10, 5, 10, minute + 5),
  }) as CalendarItemData
  const layout = computeOverlapLayout([item('a', 0), item('b', 10)], 60)
  expect(layout.map(({ totalColumns }) => totalColumns)).toEqual([2, 2])
  expect(layout.map(({ columnIndex }) => columnIndex)).toEqual([0, 1])
})

it('uses the zoom level and leaves enough-spaced events full width', () => {
  const item = (id: string, minute: number) => ({
    id,
    startTime: new Date(2026, 10, 5, 10, minute),
    endTime: new Date(2026, 10, 5, 10, minute + 5),
  }) as CalendarItemData
  expect(computeOverlapLayout([item('a', 0), item('b', 15)], 120).map(x => x.totalColumns)).toEqual([1, 1])
  expect(computeOverlapLayout([item('a', 0), item('b', 15)], 60).map(x => x.totalColumns)).toEqual([2, 2])
})
