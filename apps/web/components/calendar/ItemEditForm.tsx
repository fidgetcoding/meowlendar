'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { ChevronDown, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Calendar, Tag } from '@poolendar/types'
import type { AnchorRect } from '@/lib/stores/ui-store'
import { RecurrenceEditDialog, type RecurrenceEditScope } from './RecurrenceEditDialog'
import {
  safeFormatDate,
  localInstant,
  allDayInstant,
  allDayDate,
  allDayLastDate,
  shiftDate,
} from './item-edit-form-parts'
import { EditPopover } from './edit/EditPopover'
import { AlsoOnLine } from './EventCopies'
import {
  AttendeesRow,
  BlockLine,
  ConferencingRow,
  DateTimeLine,
  EstimateLine,
  ImportanceRow,
  LocationRow,
  RepeatLine,
  Row,
  SettingsRow,
  SubtasksRow,
  TagsRow,
  TimeZoneLine,
} from './edit/EditFormSections'

/** "HH:mm" from a routine time ("08:00", "08:00:00") or a full timestamp; else the fallback. */
function wallTime(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? fallback : format(d, 'HH:mm')
}

type EditItemType = 'event' | 'task' | 'routine'

interface SubtaskItem {
  id: string
  title: string
  completed: boolean
  time_estimate_minutes: number | null
}

interface ItemEditFormProps {
  mode: 'create' | 'edit'
  initialType: EditItemType
  initialData?: {
    title?: string
    notes?: string
    location?: string | null
    calendar_id?: string | null
    start_time?: string
    end_time?: string
    scheduled_start?: string
    scheduled_end?: string
    is_all_day?: boolean
    timezone?: string
    recurrence_rule?: string | null
    conferencing_url?: string | null
    visibility?: 'busy' | 'free'
    privacy?: 'public' | 'private'
    attendees?: { email: string; name?: string }[]
    reminders?: { minutes_before: number }[]
    importance?: string
    time_estimate_minutes?: number | null
    due_date?: string | null
    earliest_start?: string | null
    flexibility?: 'flexible' | 'not_flexible'
    subtasks?: SubtaskItem[]
    tags?: Tag[]
  }
  calendars: Calendar[]
  availableTags: Tag[]
  onSave: (type: EditItemType, data: Record<string, unknown>, scope?: RecurrenceEditScope) => void
  onDelete?: (scope?: RecurrenceEditScope) => void
  onClose: () => void
  /** Split the (existing) task's subtasks into standalone tasks (#23d). */
  onSplit?: () => void
  /** Pre-selected recurrence scope from the preview popover dialog */
  recurrenceScope?: RecurrenceEditScope
  /** The slot or item to open beside (see EditPopover). */
  anchor?: AnchorRect | null
  /** Without an anchor, the grid item to find and open beside. */
  anchorItemId?: string | null
  /** The other calendars this meeting is on. */
  alsoOn?: string[]
}

export type ItemEditFormInitialData = NonNullable<ItemEditFormProps['initialData']>

const TABS: { value: EditItemType; label: string }[] = [
  { value: 'event', label: 'Event' },
  { value: 'task', label: 'Task' },
  { value: 'routine', label: 'Routine' },
]


export function ItemEditForm({
  mode,
  initialType,
  initialData,
  calendars,
  availableTags,
  onSave,
  onDelete,
  onClose,
  onSplit,
  recurrenceScope,
  anchor = null,
  anchorItemId = null,
  alsoOn = [],
}: ItemEditFormProps) {
  const [activeTab, setActiveTab] = React.useState<EditItemType>(initialType)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)

  // Track whether the item being edited is recurring
  const isRecurring = Boolean(initialData?.recurrence_rule)

  // Shared fields
  const [title, setTitle] = React.useState(initialData?.title ?? '')
  const [notes, setNotes] = React.useState(initialData?.notes ?? '')
  const [location, setLocation] = React.useState(initialData?.location ?? '')
  const [calendarId, setCalendarId] = React.useState(
    initialData?.calendar_id ?? calendars.find((c) => c.is_primary)?.id ?? calendars[0]?.id ?? ''
  )
  // A new all-day event shows as free and a timed one as busy, as Google does, until the user
  // picks busy or free themselves. An existing event keeps whatever it had.
  const [visibility, setVisibilityState] = React.useState(
    initialData?.visibility ?? (mode === 'create' && initialData?.is_all_day ? 'free' : 'busy'),
  )
  const visibilityChosen = React.useRef(Boolean(initialData?.visibility) || mode === 'edit')
  const setVisibility = (v: 'busy' | 'free') => {
    visibilityChosen.current = true
    setVisibilityState(v)
  }
  const [privacy, setPrivacy] = React.useState(initialData?.privacy ?? 'public')
  const [reminders, setReminders] = React.useState<{ minutes_before: number }[]>(
    initialData?.reminders ?? []
  )

  // Event fields. The form shows and reads times in the viewer's own zone; an event keeps the zone
  // it was made in, and a new one takes the viewer's.
  const viewZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timeZone = initialData?.timezone ?? viewZone
  const [isAllDay, setIsAllDay] = React.useState(initialData?.is_all_day ?? false)
  const [startDate, setStartDate] = React.useState(
    initialData?.is_all_day
      ? allDayDate(initialData.start_time, format(new Date(), 'yyyy-MM-dd'))
      : safeFormatDate(initialData?.start_time, 'yyyy-MM-dd', format(new Date(), 'yyyy-MM-dd'))
  )
  // An all-day item has no time of day; switching it to timed starts from the defaults.
  const [startTime, setStartTime] = React.useState(
    initialData?.is_all_day ? '09:00' : safeFormatDate(initialData?.start_time, 'HH:mm', '09:00')
  )
  const [endDate, setEndDate] = React.useState(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    if (!initialData?.is_all_day) return safeFormatDate(initialData?.end_time, 'yyyy-MM-dd', today)
    const start = allDayDate(initialData.start_time, today)
    return allDayLastDate(start, allDayDate(initialData.end_time, start))
  })
  const [endTime, setEndTime] = React.useState(
    initialData?.is_all_day ? '10:00' : safeFormatDate(initialData?.end_time, 'HH:mm', '10:00')
  )
  const [recurrenceRule, setRecurrenceRule] = React.useState<string | null>(
    initialData?.recurrence_rule ?? null
  )
  const [conferencingUrl, setConferencingUrl] = React.useState(
    initialData?.conferencing_url ?? ''
  )
  const [attendeeEmails, setAttendeeEmails] = React.useState<string[]>(
    initialData?.attendees?.map((a) => a.email) ?? []
  )
  const [newAttendee, setNewAttendee] = React.useState('')

  // Task fields
  const [importance, setImportance] = React.useState(initialData?.importance ?? 'normal')
  const [timeEstimate, setTimeEstimate] = React.useState(
    initialData?.time_estimate_minutes
      ? initialData.time_estimate_minutes >= 60
        ? `${Math.floor(initialData.time_estimate_minutes / 60)}h`
        : `${initialData.time_estimate_minutes}m`
      : ''
  )
  const [dueDate, setDueDate] = React.useState(initialData?.due_date ?? '')
  const [earliestStart, setEarliestStart] = React.useState(initialData?.earliest_start ?? '')
  const [scheduledStartDate, setScheduledStartDate] = React.useState(
    initialData?.scheduled_start
      ? format(new Date(initialData.scheduled_start), 'yyyy-MM-dd')
      : ''
  )
  const [scheduledStartTime, setScheduledStartTime] = React.useState(
    initialData?.scheduled_start
      ? format(new Date(initialData.scheduled_start), 'HH:mm')
      : ''
  )
  const [scheduledEndDate, setScheduledEndDate] = React.useState(
    initialData?.scheduled_end
      ? format(new Date(initialData.scheduled_end), 'yyyy-MM-dd')
      : ''
  )
  const [scheduledEndTime, setScheduledEndTime] = React.useState(
    initialData?.scheduled_end
      ? format(new Date(initialData.scheduled_end), 'HH:mm')
      : ''
  )
  const [subtasks, setSubtasks] = React.useState<SubtaskItem[]>(
    initialData?.subtasks ?? []
  )
  const [selectedTags, setSelectedTags] = React.useState<Tag[]>(
    initialData?.tags ?? []
  )

  // Routine fields
  // A routine's own times are "HH:mm"; a slot handed in for a new item is a full timestamp.
  const [routineStartTime, setRoutineStartTime] = React.useState(
    wallTime(initialData?.start_time, '09:00')
  )
  const [routineEndTime, setRoutineEndTime] = React.useState(
    wallTime(initialData?.end_time, '10:00')
  )

  function addAttendee() {
    const email = newAttendee.trim()
    if (!email || attendeeEmails.includes(email)) return
    setAttendeeEmails([...attendeeEmails, email])
    setNewAttendee('')
  }

  function removeAttendee(email: string) {
    setAttendeeEmails(attendeeEmails.filter((e) => e !== email))
  }

  function toggleTag(tag: Tag) {
    if (selectedTags.some((t) => t.id === tag.id)) {
      setSelectedTags(selectedTags.filter((t) => t.id !== tag.id))
    } else {
      setSelectedTags([...selectedTags, tag])
    }
  }

  function parseTimeEstimateMinutes(input: string): number | null {
    const trimmed = input.trim().toLowerCase()
    if (!trimmed) return null
    const hMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*h/)
    if (hMatch) return Math.round(parseFloat(hMatch[1]!) * 60)
    const mMatch = trimmed.match(/^(\d+)\s*m/)
    if (mMatch) return parseInt(mMatch[1]!, 10)
    const n = parseInt(trimmed, 10)
    return isNaN(n) ? null : n
  }

  /** What Save would send for the open tab. */
  function buildPayload(): { type: EditItemType; data: Record<string, unknown> } {
    const shared: Record<string, unknown> = {
      title,
      notes: notes || null,
      location: location || null,
      calendar_id: calendarId || null,
      visibility,
      privacy,
      reminders,
    }

    if (activeTab === 'event') {
      return { type: 'event', data: {
        ...shared,
        is_all_day: isAllDay,
        start_time: isAllDay ? allDayInstant(startDate) : localInstant(startDate, startTime),
        // All-day: the end is exclusive (the day after the last), so one day is never zero length.
        end_time: isAllDay
          ? allDayInstant(shiftDate(endDate < startDate ? startDate : endDate, 1))
          : localInstant(endDate, endTime),
        timezone: timeZone,
        recurrence_rule: recurrenceRule,
        conferencing_url: conferencingUrl || null,
        attendees: attendeeEmails.map((email) => ({ email, response_status: 'needsAction' })),
      } }
    }
    if (activeTab === 'task') {
      return { type: 'task', data: {
        ...shared,
        importance,
        time_estimate_minutes: parseTimeEstimateMinutes(timeEstimate),
        due_date: dueDate || null,
        earliest_start: earliestStart || null,
        scheduled_start:
          scheduledStartDate && scheduledStartTime
            ? localInstant(scheduledStartDate, scheduledStartTime)
            : null,
        scheduled_end:
          scheduledEndDate && scheduledEndTime
            ? localInstant(scheduledEndDate, scheduledEndTime)
            : null,
        subtasks,
        tags: selectedTags.map((t) => t.id),
      } }
    }
    return { type: 'routine', data: {
      ...shared,
      start_time: routineStartTime,
      end_time: routineEndTime,
      recurrence_rule: recurrenceRule ?? 'FREQ=DAILY',
    } }
  }

  function handleSave() {
    if (!title.trim()) return
    const { type, data } = buildPayload()
    onSave(type, data, recurrenceScope)
  }

  // The form as it opened. A press outside closes it only while nothing has changed since.
  const snapshot = (p: ReturnType<typeof buildPayload>) => JSON.stringify([p.type, p.data, newAttendee])
  const openedAs = React.useRef<string | null>(null)
  if (openedAs.current === null) openedAs.current = snapshot(buildPayload())
  function handleOutsidePress() {
    if (deleteDialogOpen) return
    if (snapshot(buildPayload()) === openedAs.current) onClose()
  }

  /** Switching kind keeps the title, and carries the time over so the item stays where it was. */
  function switchTab(next: EditItemType) {
    if (next === activeTab) return
    const from = activeTab === 'task' && scheduledStartDate && scheduledStartTime
      ? { date: scheduledStartDate, start: scheduledStartTime, endDate: scheduledEndDate || scheduledStartDate, end: scheduledEndTime || scheduledStartTime }
      : activeTab === 'routine'
        ? { date: startDate, start: routineStartTime, endDate: startDate, end: routineEndTime }
        : activeTab === 'event' && !isAllDay
          ? { date: startDate, start: startTime, endDate, end: endTime }
          : null
    if (from) {
      if (next === 'event') {
        setStartDate(from.date); setStartTime(from.start); setEndDate(from.endDate); setEndTime(from.end)
      } else if (next === 'task') {
        setScheduledStartDate(from.date); setScheduledStartTime(from.start)
        setScheduledEndDate(from.endDate); setScheduledEndTime(from.end)
      } else {
        setRoutineStartTime(from.start); setRoutineEndTime(from.end)
      }
    }
    setActiveTab(next)
  }

  // ⌘Enter saves the open form, Esc discards it (#71). A ref keeps the latest
  // handleSave without re-registering the listener on every keystroke.
  const saveRef = React.useRef(handleSave)
  saveRef.current = handleSave
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        saveRef.current()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleDeleteClick() {
    if (isRecurring) {
      setDeleteDialogOpen(true)
    } else {
      onDelete?.()
    }
  }

  function handleDeleteScopeSelect(scope: RecurrenceEditScope) {
    setDeleteDialogOpen(false)
    onDelete?.(scope)
  }

  // The title takes focus once the card is on the page; on a new item its text is selected so
  // typing replaces it.
  const focused = React.useRef(false)
  const titleRef = React.useCallback((input: HTMLInputElement | null) => {
    if (!input || focused.current) return
    focused.current = true
    input.focus({ preventScroll: true })
    if (mode === 'create') input.select()
  }, [mode])

  const calendar = calendars.find((c) => c.id === calendarId)
  const kindLabel = activeTab === 'event' ? 'event' : activeTab === 'task' ? 'task' : 'routine'
  const settings = (
    <SettingsRow
      reminders={reminders}
      onReminders={setReminders}
      visibility={visibility as 'busy' | 'free'}
      onVisibility={setVisibility}
      privacy={privacy as 'public' | 'private'}
      onPrivacy={setPrivacy}
    />
  )

  return (
    <EditPopover
      anchor={anchor}
      anchorItemId={anchorItemId}
      label={mode === 'create' ? `New ${kindLabel}` : `Edit ${kindLabel}`}
      onOutsidePress={handleOutsidePress}
    >
      {/* Calendar on the left, the kind of item on the right */}
      <div className="meow-ef-top">
        <label className="meow-ef-cal">
          <span className="meow-ef-dot" style={{ background: calendar?.color ?? 'var(--peri)' }} aria-hidden="true" />
          <span className="truncate">{calendar?.name ?? 'Calendar'}</span>
          {calendars.length > 1 && <ChevronDown size={13} aria-hidden="true" />}
          <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} aria-label="Calendar">
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>{cal.name}</option>
            ))}
          </select>
        </label>
        <div className="meow-ef-tabs" role="group" aria-label="Kind">
          {TABS.map((tab) => (
            <button key={tab.value} type="button" onClick={() => switchTab(tab.value)} aria-pressed={activeTab === tab.value} className={cn(activeTab === tab.value && 'is-on')}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <AlsoOnLine labels={alsoOn} className="flex-none px-4 pb-1" />

      <div className="meow-ef-body">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the title saves, as in the quick-add bubble (not while composing text).
            // Cmd/Ctrl+Enter is the form-wide shortcut, handled once below.
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSave()
            }
          }}
          placeholder="Add title"
          aria-label="Title"
          className="meow-ef-title"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes"
          aria-label="Notes"
          rows={2}
          className="meow-ef-notes"
        />

        {activeTab === 'event' && (
          <>
            <AttendeesRow emails={attendeeEmails} draft={newAttendee} onDraft={setNewAttendee} onAdd={addAttendee} onRemove={removeAttendee} />
            <Row icon={Clock}>
              <div className="meow-ef-block">
                <BlockLine label="All day" htmlFor="ef-allday">
                  <input
                    id="ef-allday"
                    type="checkbox"
                    checked={isAllDay}
                    onChange={(e) => {
                      setIsAllDay(e.target.checked)
                      if (!visibilityChosen.current) setVisibilityState(e.target.checked ? 'free' : 'busy')
                    }}
                    aria-label="All day"
                    className="meow-ef-check"
                  />
                </BlockLine>
                <DateTimeLine id="ef-start" label="Starts" date={startDate} time={startTime} onDate={setStartDate} onTime={setStartTime} showTime={!isAllDay} />
                <DateTimeLine id="ef-end" label="Ends" date={endDate} time={endTime} onDate={setEndDate} onTime={setEndTime} showTime={!isAllDay} />
                {!isAllDay && <TimeZoneLine zone={viewZone} />}
                <RepeatLine value={recurrenceRule} onChange={setRecurrenceRule} />
              </div>
            </Row>
            <LocationRow value={location} onChange={setLocation} />
            <ConferencingRow value={conferencingUrl} onChange={setConferencingUrl} />
            {settings}
          </>
        )}

        {activeTab === 'task' && (
          <>
            <ImportanceRow value={importance} onChange={setImportance} />
            <Row icon={Clock}>
              <div className="meow-ef-block">
                <BlockLine label="Due" htmlFor="ef-due">
                  <input id="ef-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="meow-ef-input" />
                </BlockLine>
                <BlockLine label="Earliest" htmlFor="ef-earliest">
                  <input id="ef-earliest" type="date" value={earliestStart} onChange={(e) => setEarliestStart(e.target.value)} className="meow-ef-input" />
                </BlockLine>
                <DateTimeLine id="ef-sstart" label="Starts" date={scheduledStartDate} time={scheduledStartTime} onDate={setScheduledStartDate} onTime={setScheduledStartTime} showTime />
                <DateTimeLine id="ef-send" label="Ends" date={scheduledEndDate} time={scheduledEndTime} onDate={setScheduledEndDate} onTime={setScheduledEndTime} showTime />
                <EstimateLine value={timeEstimate} onChange={setTimeEstimate} />
              </div>
            </Row>
            <LocationRow value={location} onChange={setLocation} />
            <SubtasksRow subtasks={subtasks} onChange={setSubtasks} onSplit={mode === 'edit' ? onSplit : undefined} />
            <TagsRow tags={availableTags} selected={selectedTags} onToggle={toggleTag} />
            {settings}
          </>
        )}

        {activeTab === 'routine' && (
          <>
            <Row icon={Clock}>
              <div className="meow-ef-block">
                <BlockLine label="Starts" htmlFor="ef-rstart">
                  <input id="ef-rstart" type="time" value={routineStartTime} onChange={(e) => setRoutineStartTime(e.target.value)} className="meow-ef-input" />
                </BlockLine>
                <BlockLine label="Ends" htmlFor="ef-rend">
                  <input id="ef-rend" type="time" value={routineEndTime} onChange={(e) => setRoutineEndTime(e.target.value)} className="meow-ef-input" />
                </BlockLine>
                <RepeatLine value={recurrenceRule ?? 'FREQ=DAILY'} onChange={setRecurrenceRule} />
              </div>
            </Row>
            <LocationRow value={location} onChange={setLocation} />
            {settings}
          </>
        )}
      </div>

      <div className="meow-ef-foot">
        {mode === 'edit' && onDelete && (
          <button type="button" onClick={handleDeleteClick} className="meow-ef-delete">
            Delete
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="meow-ef-cancel">
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={!title.trim()} className="meow-ef-save">
          {mode === 'create' ? 'Create' : 'Save'}
        </button>
      </div>

      {/* Recurrence scope dialog for delete on recurring items */}
      <RecurrenceEditDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onSelect={handleDeleteScopeSelect}
        itemTitle={title || initialData?.title || ''}
        mode="delete"
      />
    </EditPopover>
  )
}
