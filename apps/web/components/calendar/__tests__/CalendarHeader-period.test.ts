import { describe, expect, it } from 'vitest'
import { formatPeriodContext, formatDateLabel } from '../CalendarHeader'

const now = new Date(2026, 10, 5, 12)
describe('calendar period context', () => {
  it('names the displayed day, week, or month relative to today', () => {
    expect(formatPeriodContext(now, 'day', now)).toBe('Today')
    expect(formatPeriodContext(new Date(2026, 10, 6), 'day', now)).toBe('Tomorrow')
    expect(formatPeriodContext(now, 'week', now)).toBe('This week')
    expect(formatPeriodContext(new Date(2026, 10, 12), 'week', now)).toBe('Next week')
    expect(formatPeriodContext(now, 'month', now)).toBe('This month')
    expect(formatPeriodContext(new Date(2026, 11, 5), 'month', now)).toBe('Next month')
  })
  it('uses actual dates rather than calling a distant view next week', () => {
    expect(formatPeriodContext(new Date(2026, 10, 26), 'week', now)).toBe('Week of Nov 22')
  })
})


it('shows the actual visible range for two-week and custom views', () => {
  expect(formatDateLabel(new Date(2026, 10, 5), '2weeks')).toBe('Nov 1 - 14, 2026')
  expect(formatDateLabel(new Date(2026, 10, 5), 'custom', 3)).toBe('Nov 5 - 7, 2026')
})
