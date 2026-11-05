import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Select } from '../Select'

vi.stubGlobal('React', React)
afterEach(cleanup)

const options = [{ value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]

// aria-controls carried a useId into the server HTML. When the tree above the Select renders
// differently in the browser, the id differs and hydration fails on that attribute.
it('keeps the generated id out of the server HTML', () => {
  const html = renderToString(<Select options={options} value="week" aria-label="Calendar view" />)
  expect(html).not.toContain('aria-controls')
})

it('points aria-controls at the list while it is open', () => {
  render(<Select options={options} value="week" aria-label="Calendar view" />)
  const trigger = screen.getByRole('combobox', { name: 'Calendar view' })
  expect(trigger.getAttribute('aria-controls')).toBeNull()
  fireEvent.click(trigger)
  const listbox = screen.getByRole('listbox')
  expect(trigger.getAttribute('aria-controls')).toBe(listbox.id)
})
