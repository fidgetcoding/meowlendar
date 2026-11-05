import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Calendar, CalendarEvent } from '@poolendar/types'
import { copyLabels, otherCopiesOf, rsvpCopies } from '../event-copies'
import { RsvpRow } from '../EventCopies'
import { PreviewPopover } from '../PreviewPopover'
import { ItemEditForm } from '../ItemEditForm'

vi.stubGlobal('React', React)
afterEach(cleanup)

const calendar = (id: string, name: string, account: string | null, extra: Partial<Calendar> = {}) =>
  ({ id, name, color: '#5a68d4', google_account_id: account, source: account ? 'google' : 'local', ...extra }) as Calendar
const work = calendar('c-work', 'Work', 'acct-work')
const home = calendar('c-home', 'Personal', 'acct-home')
const teamA = calendar('c-team-a', 'Team', 'acct-work')
const teamB = calendar('c-team-b', 'Team', 'acct-home')
const local = calendar('c-local', 'My Calendar', null)
const calendars = [work, home, teamA, teamB, local]
const accounts = { 'acct-work': 'nate@work.test', 'acct-home': 'nate@home.test' }

let seq = 0
function copy(calendarId: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `e${++seq}`,
    calendar_id: calendarId,
    title: 'Kickoff',
    ical_uid: 'kickoff@google.com',
    start_time: '2030-01-08T10:00:00Z',
    end_time: '2030-01-08T11:00:00Z',
    status: 'confirmed',
    attendees: [],
    ...extra,
  } as CalendarEvent
}
const guest = (email: string, response_status: 'accepted' | 'needsAction' | 'declined') => [{ email, response_status, self: true }]

describe('the copies of one meeting', () => {
  it('finds the copies on other calendars, by iCalUID or by title and times', () => {
    const shown = copy(work.id)
    const sameUid = copy(home.id, { title: 'Kickoff (Acme)' })
    const sameTimes = copy(teamA.id, { ical_uid: 'other@outlook.test' })
    const sameCalendar = copy(work.id)
    const laterDay = copy(teamB.id, { start_time: '2030-01-09T10:00:00Z', end_time: '2030-01-09T11:00:00Z' })
    expect(otherCopiesOf(shown, [shown, sameUid, sameTimes, sameCalendar, laterDay]).map((e) => e.id)).toEqual([sameUid.id, sameTimes.id])
  })

  it('names each copy by calendar, adding the account when two calendars share a name', () => {
    expect(copyLabels([copy(work.id), copy(home.id)], calendars, accounts)).toEqual(['Work', 'Personal'])
    expect(copyLabels([copy(teamA.id), copy(teamB.id)], calendars, accounts)).toEqual(['Team (nate@work.test)', 'Team (nate@home.test)'])
  })

  it('offers a reply only from Google copies where you are a guest, the shown copy first', () => {
    const copies = [
      copy(work.id, { attendees: guest('nate@work.test', 'accepted') }),
      copy(teamA.id),
      copy(home.id, { attendees: [{ email: 'nate@home.test', response_status: 'needsAction' }] }),
      copy(local.id, { attendees: guest('nate@work.test', 'accepted') }),
    ]
    expect(rsvpCopies(copies, calendars, accounts)).toEqual([
      { eventId: copies[0]!.id, account: 'nate@work.test', response: 'accepted' },
      { eventId: copies[2]!.id, account: 'nate@home.test', response: 'needsAction' },
    ])
  })
})

describe('answering an invitation', () => {
  const copies = [
    { eventId: 'kept', account: 'nate@work.test', response: 'needsAction' as const },
    { eventId: 'other', account: 'nate@home.test', response: 'needsAction' as const },
  ]

  it('answers from the copy shown unless you pick another account', async () => {
    const onRespond = vi.fn().mockResolvedValue({})
    render(<RsvpRow copies={copies} onRespond={onRespond} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Maybe' })) })
    expect(onRespond).toHaveBeenLastCalledWith('kept', 'tentative')
    expect(screen.getByRole('button', { name: 'Maybe' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.change(screen.getByLabelText('Answer as'), { target: { value: '1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'No' })) })
    expect(onRespond).toHaveBeenLastCalledWith('other', 'declined')
  })

  it('shows why a reply failed, and keeps the old answer', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error("Couldn't send your reply to Google. Try again."))
    render(<RsvpRow copies={copies.slice(0, 1)} onRespond={onRespond} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes' })) })
    expect(screen.getByRole('alert').textContent).toBe("Couldn't send your reply to Google. Try again.")
    expect(screen.getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByLabelText('Answer as')).toBeNull()
  })
})

describe('"Also on"', () => {
  it('is a quiet line on the preview card, with the reply buttons', () => {
    render(
      <PreviewPopover
        item={{ type: 'event', event: copy(work.id, { attendees: guest('nate@work.test', 'accepted') }), calendarName: 'Work' }}
        anchorRect={new DOMRect(100, 100, 120, 40)}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        alsoOn={['Personal', 'Team']}
        rsvpCopies={[{ eventId: 'kept', account: 'nate@work.test', response: 'accepted' }]}
        onRsvp={vi.fn()}
      />,
    )
    const card = screen.getByRole('dialog', { name: /preview/i })
    expect(within(card).getByText('Also on Personal · Team')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Yes' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('is left out of a preview with no other copies', () => {
    render(<PreviewPopover item={{ type: 'event', event: copy(work.id) }} anchorRect={new DOMRect(0, 0, 10, 10)} onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByText(/^Also on/)).toBeNull()
    expect(screen.queryByRole('group', { name: 'Going?' })).toBeNull()
  })

  it('sits in the edit popover header', () => {
    const event = { title: 'Kickoff', start_time: new Date(2026, 10, 5, 14).toISOString(), end_time: new Date(2026, 10, 5, 15).toISOString() }
    render(<ItemEditForm mode="edit" initialType="event" initialData={event} calendars={[work]} availableTags={[]} onSave={vi.fn()} onClose={vi.fn()} alsoOn={['Personal']} />)
    expect(within(screen.getByRole('dialog')).getByText('Also on Personal')).toBeTruthy()
  })
})
