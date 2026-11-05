'use client'

import * as React from 'react'
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { useEvents } from '@/lib/hooks/use-events'
import { useTasks } from '@/lib/hooks/use-tasks'
import { useCalendarAccounts, useCalendars } from '@/lib/hooks/use-calendars'
import { useNow } from '@/lib/hooks/use-now'
import { useUIStore } from '@/lib/stores/ui-store'
import { useCalendarStore } from '@/lib/stores/calendar-store'
import { isAgentTask } from '@/lib/tasks/agent'
import { eventsToItems, tasksToItems } from '@/components/calendar/grid-items'
import { isDeclinedEvent, mergeDuplicateEventItems } from '@/components/calendar/grid-helpers'
import { formatIn, formatRange, formatTime } from '@/components/calendar/time-format'
import type { CalendarItemData } from '@/components/calendar/calendar-types'
import { SitCat } from '@/components/brand/cats'

const HORIZON_DAYS = 7
const SHOWN = 4

/**
 * The next few timed events and scheduled tasks, soonest first. All-day items and done tasks are
 * left out. Empty until mounted: there is no clock on the server (see useNow).
 */
export function useUpNext(): { items: CalendarItemData[]; now: Date | null } {
  const now = useNow()
  // The queries can start before the clock does: today is the same day either way.
  const [today] = React.useState(() => startOfDay(new Date()))
  const from = now ? startOfDay(now) : today
  const { data: events = [] } = useEvents(format(from, 'yyyy-MM-dd'), format(addDays(from, HORIZON_DAYS), 'yyyy-MM-dd'))
  const { data: tasks = [] } = useTasks()
  const { data: calendars = [] } = useCalendars()
  const { data: accounts = [] } = useCalendarAccounts()
  const mergeDuplicates = useCalendarStore((s) => s.mergeDuplicateEvents)
  const showDeclined = useCalendarStore((s) => s.showDeclinedEvents)

  const items = React.useMemo(() => {
    if (!now) return []
    const windowEnd = addDays(startOfDay(now), HORIZON_DAYS)
    // The same rules as the grid: one copy of each meeting, and declined ones only when shown there.
    let eventItems = eventsToItems(events, calendars, { start: now, end: windowEnd })
    if (mergeDuplicates) eventItems = mergeDuplicateEventItems(eventItems, calendars)
    if (!showDeclined) {
      const selfEmails = accounts.map((a) => a.email)
      eventItems = eventItems.filter((i) => !(i.event && isDeclinedEvent(i.event, selfEmails)))
    }
    const all = [
      ...eventItems,
      ...tasksToItems(tasks.filter((t) => t.status !== 'done'), calendars),
    ]
    return all
      .filter((i) => !i.isAllDay && i.startTime > now && i.startTime < windowEnd)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .slice(0, SHOWN)
  }, [events, tasks, calendars, accounts, mergeDuplicates, showDeclined, now])

  return { items, now }
}

function relativeDay(date: Date, now: Date): 'Today' | 'Tomorrow' | string {
  const diff = differenceInCalendarDays(date, now)
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : format(date, 'EEE')
}

function whenLabel(date: Date, now: Date): string {
  return differenceInCalendarDays(date, now) === 0 ? formatTime(date) : `${format(date, 'EEE')} ${formatTime(date)}`
}

function AgentCat({ item }: { item: CalendarItemData }) {
  if (!item.task || !isAgentTask(item.task)) return null
  return (
    <span title="By your agent" className="meow-up-cat">
      <SitCat coat="#e88a2c" stripes />
    </span>
  )
}

/** The panel's top card: the next thing large, the rest as rows (approved "Up next" card). */
export function UpNextCard() {
  const { items, now } = useUpNext()
  const openEditForm = useUIStore((s) => s.openEditForm)
  const [first, ...rest] = items
  if (!first || !now) return null

  const minutes = Math.round((first.startTime.getTime() - now.getTime()) / 60_000)
  const sameDay = differenceInCalendarDays(first.startTime, now) === 0
  const lead = sameDay ? formatIn(minutes) : relativeDay(first.startTime, now)

  return (
    <section className="meow-up" aria-label="Up next">
      <button
        type="button"
        className="meow-up-next"
        style={{ '--c': first.color } as React.CSSProperties}
        onClick={() => openEditForm(first.id, first.type)}
      >
        <span className="meow-up-k">
          <span>Up next</span>
          <em>{lead}</em>
        </span>
        <b>{first.title}</b>
        <span className="meow-up-tm">{formatRange(first.startTime, first.endTime)}</span>
      </button>
      {rest.length > 0 && (
        <ul>
          {rest.map((item) => (
            <li key={`${item.type}-${item.id}`} style={{ '--c': item.color } as React.CSSProperties}>
              <button type="button" onClick={() => openEditForm(item.id, item.type)}>
                <span className="meow-up-w">{whenLabel(item.startTime, now)}</span>
                <b>{item.title}</b>
                <AgentCat item={item} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Phones: one line under the header with the next thing. */
export function UpNextStrip() {
  const { items, now } = useUpNext()
  const first = items[0]
  if (!first || !now) return null
  return (
    <div className="meow-mnext" style={{ '--c': first.color } as React.CSSProperties}>
      <span className="meow-mnext-k">Up next</span>
      <i aria-hidden="true" />
      <b>{first.title}</b>
      <em>{whenLabel(first.startTime, now)}</em>
    </div>
  )
}
