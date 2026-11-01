'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import {
  X,
  MapPin,
  Globe,
  Lock,
  Zap,
  Eye,
  Link2,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Calendar, Tag } from '@poolendar/types'
import { SubtaskList } from './SubtaskList'
import { RecurrenceBuilder } from './RecurrenceBuilder'
import { ReminderEditor } from './ReminderEditor'
import { RecurrenceEditDialog, type RecurrenceEditScope } from './RecurrenceEditDialog'
import {
  IMPORTANCE_OPTIONS,
  safeFormatDate,
  fieldClass,
  SectionDivider,
  FieldLabel,
  ToggleGroup,
} from './item-edit-form-parts'

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
}: ItemEditFormProps) {
  const [activeTab, setActiveTab] = React.useState<EditItemType>(initialType)
  const [isMounted, setIsMounted] = React.useState(false)
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
  const [visibility, setVisibility] = React.useState(initialData?.visibility ?? 'busy')
  const [privacy, setPrivacy] = React.useState(initialData?.privacy ?? 'public')
  const [reminders, setReminders] = React.useState<{ minutes_before: number }[]>(
    initialData?.reminders ?? []
  )

  // Event fields
  const [isAllDay, setIsAllDay] = React.useState(initialData?.is_all_day ?? false)
  const [startDate, setStartDate] = React.useState(
    safeFormatDate(initialData?.start_time, 'yyyy-MM-dd', format(new Date(), 'yyyy-MM-dd'))
  )
  const [startTime, setStartTime] = React.useState(
    safeFormatDate(initialData?.start_time, 'HH:mm', '09:00')
  )
  const [endDate, setEndDate] = React.useState(
    safeFormatDate(initialData?.end_time, 'yyyy-MM-dd', format(new Date(), 'yyyy-MM-dd'))
  )
  const [endTime, setEndTime] = React.useState(
    safeFormatDate(initialData?.end_time, 'HH:mm', '10:00')
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
  const [routineStartTime, setRoutineStartTime] = React.useState(
    initialData?.start_time?.includes(':')
      ? initialData.start_time.slice(0, 5)
      : '09:00'
  )
  const [routineEndTime, setRoutineEndTime] = React.useState(
    initialData?.end_time?.includes(':')
      ? initialData.end_time.slice(0, 5)
      : '10:00'
  )

  React.useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])

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

  function handleSave() {
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
      onSave('event', {
        ...shared,
        is_all_day: isAllDay,
        start_time: `${startDate}T${startTime}:00`,
        end_time: `${endDate}T${endTime}:00`,
        recurrence_rule: recurrenceRule,
        conferencing_url: conferencingUrl || null,
        attendees: attendeeEmails.map((email) => ({ email, response_status: 'needsAction' })),
      }, recurrenceScope)
    } else if (activeTab === 'task') {
      onSave('task', {
        ...shared,
        importance,
        time_estimate_minutes: parseTimeEstimateMinutes(timeEstimate),
        due_date: dueDate || null,
        earliest_start: earliestStart || null,
        scheduled_start:
          scheduledStartDate && scheduledStartTime
            ? `${scheduledStartDate}T${scheduledStartTime}:00`
            : null,
        scheduled_end:
          scheduledEndDate && scheduledEndTime
            ? `${scheduledEndDate}T${scheduledEndTime}:00`
            : null,
        subtasks,
        tags: selectedTags.map((t) => t.id),
      }, recurrenceScope)
    } else {
      onSave('routine', {
        ...shared,
        start_time: routineStartTime,
        end_time: routineEndTime,
        recurrence_rule: recurrenceRule ?? 'FREQ=DAILY',
      }, recurrenceScope)
    }
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

  if (!isMounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full max-w-[480px] h-full',
          'bg-[var(--surface)] border-l border-[var(--border)]',
          'flex flex-col',
          'animate-in slide-in-from-right duration-200'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  'relative px-4 py-1.5 text-sm font-medium rounded-md',
                  'transition-colors duration-150',
                  activeTab === tab.value
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                )}
              >
                {tab.label}
                {activeTab === tab.value && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[var(--accent)] rounded-full" />
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-md',
              'text-[var(--muted)] hover:text-[var(--fg)]',
              'hover:bg-[var(--surface-hover)]',
              'transition-colors duration-150'
            )}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Title */}
          <div>
            <FieldLabel>Title</FieldLabel>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              className={fieldClass()}
              autoFocus
            />
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes..."
              rows={3}
              className={fieldClass('resize-none')}
            />
          </div>

          {/* Calendar selector */}
          <div>
            <FieldLabel>Calendar</FieldLabel>
            <select
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              className={fieldClass()}
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>

          <SectionDivider />

          {/* EVENT TAB */}
          {activeTab === 'event' && (
            <>
              {/* All-day toggle */}
              <div className="flex items-center justify-between">
                <FieldLabel>All day</FieldLabel>
                <button
                  type="button"
                  onClick={() => setIsAllDay(!isAllDay)}
                  className={cn(
                    'relative w-10 h-5 rounded-full transition-colors duration-200',
                    isAllDay ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200',
                      isAllDay ? 'translate-x-5' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>

              {/* Start date/time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Start date</FieldLabel>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
                {!isAllDay && (
                  <div>
                    <FieldLabel>Start time</FieldLabel>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className={fieldClass()}
                    />
                  </div>
                )}
              </div>

              {/* End date/time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>End date</FieldLabel>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
                {!isAllDay && (
                  <div>
                    <FieldLabel>End time</FieldLabel>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className={fieldClass()}
                    />
                  </div>
                )}
              </div>

              <SectionDivider />

              {/* Recurrence */}
              <RecurrenceBuilder value={recurrenceRule} onChange={setRecurrenceRule} />

              <SectionDivider />

              {/* Location */}
              <div>
                <FieldLabel>Location</FieldLabel>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    className={fieldClass('pl-9')}
                  />
                </div>
              </div>

              {/* Conferencing */}
              <div>
                <FieldLabel>Conferencing URL</FieldLabel>
                <div className="relative">
                  <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="url"
                    value={conferencingUrl}
                    onChange={(e) => setConferencingUrl(e.target.value)}
                    placeholder="Google Meet or Zoom link"
                    className={fieldClass('pl-9')}
                  />
                </div>
              </div>

              <SectionDivider />

              {/* Attendees */}
              <div>
                <FieldLabel>Attendees</FieldLabel>
                {attendeeEmails.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {attendeeEmails.map((email) => (
                      <span
                        key={email}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs',
                          'bg-[var(--bg)] border border-[var(--border)] text-[var(--fg)]'
                        )}
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeAttendee(email)}
                          className="text-[var(--muted)] hover:text-[var(--destructive)]"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={newAttendee}
                    onChange={(e) => setNewAttendee(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addAttendee()
                      }
                    }}
                    placeholder="Add email"
                    className={fieldClass('flex-1')}
                  />
                  <button
                    type="button"
                    onClick={addAttendee}
                    className={cn(
                      'flex items-center gap-1 px-3 py-2 rounded-md text-sm',
                      'border border-[var(--border)] text-[var(--muted)]',
                      'hover:text-[var(--fg)] hover:border-[var(--accent)]',
                      'transition-colors duration-150'
                    )}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <SectionDivider />

              {/* Reminders */}
              <ReminderEditor reminders={reminders} onChange={setReminders} />

              <SectionDivider />

              {/* Visibility / Privacy */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Visibility</FieldLabel>
                  <ToggleGroup
                    options={[
                      { value: 'busy', label: 'Busy', icon: Eye },
                      { value: 'free', label: 'Free', icon: Zap },
                    ]}
                    value={visibility}
                    onChange={(v) => setVisibility(v as 'busy' | 'free')}
                  />
                </div>
                <div>
                  <FieldLabel>Privacy</FieldLabel>
                  <ToggleGroup
                    options={[
                      { value: 'public', label: 'Public', icon: Globe },
                      { value: 'private', label: 'Private', icon: Lock },
                    ]}
                    value={privacy}
                    onChange={(v) => setPrivacy(v as 'public' | 'private')}
                  />
                </div>
              </div>
            </>
          )}

          {/* TASK TAB */}
          {activeTab === 'task' && (
            <>
              {/* Importance */}
              <div>
                <FieldLabel>Importance</FieldLabel>
                <div className="flex gap-1">
                  {IMPORTANCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setImportance(opt.value)}
                      className={cn(
                        'flex-1 px-2 py-1.5 text-xs font-medium rounded-md',
                        'border transition-colors duration-150',
                        importance === opt.value
                          ? 'border-transparent text-white'
                          : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
                      )}
                      style={
                        importance === opt.value
                          ? { backgroundColor: opt.color }
                          : undefined
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time estimate */}
              <div>
                <FieldLabel>Time estimate</FieldLabel>
                <input
                  type="text"
                  value={timeEstimate}
                  onChange={(e) => setTimeEstimate(e.target.value)}
                  placeholder='e.g., "60m" or "2h"'
                  className={fieldClass()}
                />
              </div>

              {/* Due date / Earliest start */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Due date</FieldLabel>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
                <div>
                  <FieldLabel>Earliest start</FieldLabel>
                  <input
                    type="date"
                    value={earliestStart}
                    onChange={(e) => setEarliestStart(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
              </div>

              {/* Scheduled start/end */}
              <div>
                <FieldLabel>Scheduled slot (calendar)</FieldLabel>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={scheduledStartDate}
                    onChange={(e) => setScheduledStartDate(e.target.value)}
                    placeholder="Start date"
                    className={fieldClass()}
                  />
                  <input
                    type="time"
                    value={scheduledStartTime}
                    onChange={(e) => setScheduledStartTime(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <input
                    type="date"
                    value={scheduledEndDate}
                    onChange={(e) => setScheduledEndDate(e.target.value)}
                    placeholder="End date"
                    className={fieldClass()}
                  />
                  <input
                    type="time"
                    value={scheduledEndTime}
                    onChange={(e) => setScheduledEndTime(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <FieldLabel>Location</FieldLabel>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    className={fieldClass('pl-9')}
                  />
                </div>
              </div>

              <SectionDivider />

              {/* Subtasks */}
              <SubtaskList
                subtasks={subtasks}
                onChange={setSubtasks}
                onSplit={mode === 'edit' ? onSplit : undefined}
              />

              <SectionDivider />

              {/* Tags */}
              <div>
                <FieldLabel>Tags</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => {
                    const selected = selectedTags.some((t) => t.id === tag.id)
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium',
                          'border transition-colors duration-150',
                          selected
                            ? 'border-transparent text-white'
                            : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
                        )}
                        style={
                          selected
                            ? { backgroundColor: tag.color }
                            : undefined
                        }
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.prefix ? `${tag.prefix} ${tag.name}` : tag.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <SectionDivider />

              {/* Reminders */}
              <ReminderEditor reminders={reminders} onChange={setReminders} />

              <SectionDivider />

              {/* Visibility / Privacy */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Visibility</FieldLabel>
                  <ToggleGroup
                    options={[
                      { value: 'busy', label: 'Busy', icon: Eye },
                      { value: 'free', label: 'Free', icon: Zap },
                    ]}
                    value={visibility}
                    onChange={(v) => setVisibility(v as 'busy' | 'free')}
                  />
                </div>
                <div>
                  <FieldLabel>Privacy</FieldLabel>
                  <ToggleGroup
                    options={[
                      { value: 'public', label: 'Public', icon: Globe },
                      { value: 'private', label: 'Private', icon: Lock },
                    ]}
                    value={privacy}
                    onChange={(v) => setPrivacy(v as 'public' | 'private')}
                  />
                </div>
              </div>
            </>
          )}

          {/* ROUTINE TAB */}
          {activeTab === 'routine' && (
            <>
              {/* Time range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Start time</FieldLabel>
                  <input
                    type="time"
                    value={routineStartTime}
                    onChange={(e) => setRoutineStartTime(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
                <div>
                  <FieldLabel>End time</FieldLabel>
                  <input
                    type="time"
                    value={routineEndTime}
                    onChange={(e) => setRoutineEndTime(e.target.value)}
                    className={fieldClass()}
                  />
                </div>
              </div>

              <SectionDivider />

              {/* Recurrence */}
              <RecurrenceBuilder
                value={recurrenceRule ?? 'FREQ=DAILY'}
                onChange={setRecurrenceRule}
              />

              <SectionDivider />

              {/* Location */}
              <div>
                <FieldLabel>Location</FieldLabel>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location"
                    className={fieldClass('pl-9')}
                  />
                </div>
              </div>

              <SectionDivider />

              {/* Reminders */}
              <ReminderEditor reminders={reminders} onChange={setReminders} />

              <SectionDivider />

              {/* Visibility / Privacy */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Visibility</FieldLabel>
                  <ToggleGroup
                    options={[
                      { value: 'busy', label: 'Busy', icon: Eye },
                      { value: 'free', label: 'Free', icon: Zap },
                    ]}
                    value={visibility}
                    onChange={(v) => setVisibility(v as 'busy' | 'free')}
                  />
                </div>
                <div>
                  <FieldLabel>Privacy</FieldLabel>
                  <ToggleGroup
                    options={[
                      { value: 'public', label: 'Public', icon: Globe },
                      { value: 'private', label: 'Private', icon: Lock },
                    ]}
                    value={privacy}
                    onChange={(v) => setPrivacy(v as 'public' | 'private')}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
          <div>
            {mode === 'edit' && onDelete && (
              <button
                type="button"
                onClick={handleDeleteClick}
                className={cn(
                  'px-4 py-2 rounded-md text-sm font-medium',
                  'text-[var(--destructive)] hover:bg-[var(--destructive)] hover:text-white',
                  'border border-[var(--destructive)]',
                  'transition-colors duration-150'
                )}
              >
                Delete
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium',
                'text-[var(--muted)] hover:text-[var(--fg)]',
                'hover:bg-[var(--surface-hover)]',
                'transition-colors duration-150'
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!title.trim()}
              className={cn(
                'px-6 py-2 rounded-md text-sm font-medium',
                'bg-[var(--accent)] text-[var(--bg)]',
                'hover:bg-[var(--accent-hover)]',
                'disabled:opacity-50 disabled:pointer-events-none',
                'transition-colors duration-150'
              )}
            >
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Recurrence scope dialog for delete on recurring items */}
      <RecurrenceEditDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onSelect={handleDeleteScopeSelect}
        itemTitle={title || initialData?.title || ''}
        mode="delete"
      />
    </div>,
    document.body
  )
}
