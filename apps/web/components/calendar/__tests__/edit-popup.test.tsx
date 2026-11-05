import * as React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemEditForm } from '../ItemEditForm'

vi.stubGlobal('React', React)
afterEach(() => {
  cleanup()
  window.innerWidth = 1024
})

const calendars = [{ id: 'c1', name: 'Work', color: '#5a68d4', is_primary: true }] as never[]
const event = { title: 'Standup', start_time: new Date(2026, 10, 5, 14).toISOString(), end_time: new Date(2026, 10, 5, 15).toISOString() }

function open(props: Partial<React.ComponentProps<typeof ItemEditForm>> = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <ItemEditForm mode="edit" initialType="event" initialData={event} calendars={calendars} availableTags={[]} onSave={onSave} onClose={onClose} {...props} />,
  )
  return { onSave, onClose, card: screen.getByRole('dialog') }
}

/** A press outside the card. The editor acts on it after the press reaches the page. */
async function pressOutside() {
  fireEvent.mouseDown(document.body)
  await act(() => new Promise((r) => setTimeout(r, 0)))
}

// The editor used to be a full-height side panel; it's now a popup card beside its item.
describe('the editor popup', () => {
  it('is a card with the calendar, the kind tabs, the title and notes', () => {
    const { card } = open()
    expect(card.getAttribute('aria-label')).toBe('Edit event')
    expect(screen.getByLabelText('Calendar')).toBeTruthy()
    for (const kind of ['Event', 'Task', 'Routine']) expect(screen.getByRole('button', { name: kind })).toBeTruthy()
    expect(screen.getByLabelText('Title')).toBe(document.activeElement)
    expect(screen.getByPlaceholderText('Add notes')).toBeTruthy()
    for (const label of ['Add attendee', 'Location', 'Conferencing']) expect(screen.getByLabelText(label)).toBeTruthy()
    expect(screen.getByText('Starts')).toBeTruthy()
    expect(screen.getByText('Time zone')).toBeTruthy()
    expect(screen.getByText('Repeat')).toBeTruthy()
    expect(screen.getByText('No reminders · Busy · Public')).toBeTruthy()
  })

  it('opens beside its slot with a caret, when it has one', () => {
    const { card } = open({ anchor: { left: 200, top: 300, width: 140, height: 60 } })
    expect(card.dataset.placement).toBe('right')
    expect(card.querySelector('.meow-ef-caret.is-right')).not.toBeNull()
  })

  it('opens beside the item on the grid when it is on screen', () => {
    const item = document.createElement('div')
    item.setAttribute('data-calendar-item', '')
    item.setAttribute('data-item-id', 'evt-1')
    // Near the right edge of the 1024px test window, so the card has to open on its left.
    item.getBoundingClientRect = () => ({ left: 980, top: 200, width: 30, height: 50, right: 1010, bottom: 250, x: 980, y: 200, toJSON: () => ({}) })
    document.body.appendChild(item)
    const { card } = open({ anchorItemId: 'evt-1' })
    expect(card.dataset.placement).toBe('left')
    item.remove()
  })

  it('is a centred card when the item is not on the grid', () => {
    const { card } = open({ anchorItemId: 'not-on-screen' })
    expect(card.className).toContain('is-centred')
  })

  it('is a bottom sheet on phones', () => {
    window.innerWidth = 390
    const { card } = open({ anchor: { left: 20, top: 300, width: 100, height: 40 } })
    expect(card.className).toContain('is-sheet')
  })

  it('selects the title of a new item so typing replaces it', () => {
    open({ mode: 'create', initialData: { ...event, title: 'Draft' } })
    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(document.activeElement).toBe(title)
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 5])
  })

  it('switching kind keeps the title and the time', () => {
    const { onSave } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Task' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Standup')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('task', expect.objectContaining({
      title: 'Standup', scheduled_start: event.start_time, scheduled_end: event.end_time,
    }), undefined)
  })

  it('closes on Esc and on Cancel, and saves on Cmd/Ctrl+Enter and on Enter in the title', () => {
    const first = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first.onClose).toHaveBeenCalledTimes(1)
    cleanup()
    const second = open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(second.onClose).toHaveBeenCalledTimes(1)
    cleanup()
    const third = open()
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true })
    expect(third.onSave).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' })
    expect(third.onSave).toHaveBeenCalledTimes(2)
  })

  it('a press outside closes it while nothing has changed', async () => {
    const { onClose } = open()
    await pressOutside()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a press outside keeps it open once something has changed', async () => {
    const { onClose } = open()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Standup, moved' } })
    await pressOutside()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the same validation: no title, no save', () => {
    const { onSave } = open({ mode: 'create', initialData: { start_time: event.start_time, end_time: event.end_time } })
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })
})

// A birthday used to block a whole day on booking pages: all-day events defaulted to busy.
describe('busy or free for a new event', () => {
  const create = () => open({ mode: 'create', initialData: { title: 'Miso turns 4', start_time: event.start_time, end_time: event.end_time } })
  const saved = (onSave: ReturnType<typeof vi.fn>) => onSave.mock.calls.at(-1)![1] as Record<string, unknown>

  it('an all-day event shows as free, a timed one as busy, as in Google', () => {
    const { onSave } = create()
    fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    expect(screen.getByText('No reminders · Free · Public')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(saved(onSave)).toMatchObject({ is_all_day: true, visibility: 'free' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(saved(onSave)).toMatchObject({ is_all_day: false, visibility: 'busy' })
  })

  it('keeps busy or free once the user has picked it', () => {
    const { onSave } = create()
    fireEvent.click(screen.getByText('No reminders · Busy · Public'))
    fireEvent.click(screen.getByRole('button', { name: 'Busy' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(saved(onSave)).toMatchObject({ is_all_day: true, visibility: 'busy' })
  })

  it('leaves an existing event as it was', () => {
    const { onSave } = open({ initialData: { ...event, visibility: 'busy' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'All day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved(onSave)).toMatchObject({ is_all_day: true, visibility: 'busy' })
  })
})
