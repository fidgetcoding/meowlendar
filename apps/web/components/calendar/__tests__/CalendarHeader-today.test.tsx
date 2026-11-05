import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CalendarHeader } from '../CalendarHeader'

vi.stubGlobal('React', React)
afterEach(cleanup)

it('returns to today with a control between the previous and next arrows', () => {
  const onToday = vi.fn()
  render(<CalendarHeader currentDate={new Date(2026, 10, 5)} view="week" onToday={onToday} onPrev={vi.fn()} onNext={vi.fn()} onViewChange={vi.fn()} />)
  const previous = screen.getByRole('button', { name: 'Previous' })
  const control = screen.getByRole('button', { name: 'Go to today' })
  const next = screen.getByRole('button', { name: 'Next' })
  expect(previous.nextElementSibling).toBe(control)
  expect(control.nextElementSibling).toBe(next)
  fireEvent.click(control)
  expect(onToday).toHaveBeenCalledOnce()
})
