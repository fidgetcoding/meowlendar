'use client'

import * as React from 'react'
import { Bell, Flag, ListChecks, MapPin, Plus, Tag as TagIcon, Timer, Users, Video, X, Eye, Zap, Globe, Lock } from 'lucide-react'
import type { Tag } from '@poolendar/types'
import { cn } from '@/lib/utils'
import { RecurrenceBuilder } from '../RecurrenceBuilder'
import { ReminderEditor } from '../ReminderEditor'
import { SubtaskList } from '../SubtaskList'
import { IMPORTANCE_OPTIONS, ToggleGroup } from '../item-edit-form-parts'

// The editor's rows, laid out like Morgen's popup: a small icon, then the field, rows split by
// hairlines; dates and times in a compact block with right-aligned labels.

export function Row({ icon: Icon, children, className }: { icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('meow-ef-row', className)}>
      <Icon size={16} strokeWidth={1.6} className="meow-ef-ic" aria-hidden="true" />
      <div className="meow-ef-rowc">{children}</div>
    </div>
  )
}

/** A labelled line inside the time block: right-aligned label, value on the left. */
export function BlockLine({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <>
      <label className="meow-ef-bl" htmlFor={htmlFor}>{label}</label>
      <div className="meow-ef-bv">{children}</div>
    </>
  )
}

const REPEAT_LABELS: Record<string, string> = {
  'FREQ=DAILY': 'Daily',
  'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR': 'Every weekday',
  'FREQ=WEEKLY': 'Weekly',
  'FREQ=MONTHLY': 'Monthly',
  'FREQ=YEARLY': 'Yearly',
}

export function repeatSummary(rule: string | null): string {
  if (!rule) return 'Does not repeat'
  return REPEAT_LABELS[rule.replace(/^RRULE:/, '')] ?? 'Custom'
}

/** "Repeat" in the time block: the rule in words; opening it shows the full builder. */
export function RepeatLine({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <BlockLine label="Repeat">
      <button type="button" className="meow-ef-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {repeatSummary(value)}
      </button>
      {open && (
        <div className="meow-ef-sub">
          <RecurrenceBuilder value={value} onChange={onChange} />
        </div>
      )}
    </BlockLine>
  )
}

export function TimeZoneLine({ zone }: { zone: string }) {
  return (
    <BlockLine label="Time zone">
      <span className="meow-ef-static">{zone.replace(/_/g, ' ')}</span>
    </BlockLine>
  )
}

interface DateTimeProps {
  id: string
  date: string
  time: string
  onDate: (v: string) => void
  onTime: (v: string) => void
  showTime: boolean
  label: string
}

export function DateTimeLine({ id, date, time, onDate, onTime, showTime, label }: DateTimeProps) {
  return (
    <BlockLine label={label} htmlFor={`${id}-date`}>
      <span className="meow-ef-dt">
        <input id={`${id}-date`} type="date" value={date} onChange={(e) => onDate(e.target.value)} className="meow-ef-input" aria-label={`${label} date`} />
        {showTime && <input type="time" value={time} onChange={(e) => onTime(e.target.value)} className="meow-ef-input" aria-label={`${label} time`} />}
      </span>
    </BlockLine>
  )
}

export function TextRow({ icon, value, onChange, placeholder, type = 'text', label }: {
  icon: React.ElementType; value: string; onChange: (v: string) => void; placeholder: string; type?: string; label: string
}) {
  return (
    <Row icon={icon}>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className="meow-ef-input is-wide" />
    </Row>
  )
}

export const LocationRow = (p: { value: string; onChange: (v: string) => void }) => (
  <TextRow icon={MapPin} label="Location" placeholder="Add location" {...p} />
)

export const ConferencingRow = (p: { value: string; onChange: (v: string) => void }) => (
  <TextRow icon={Video} label="Conferencing" placeholder="Add a Google Meet or Zoom link" type="url" {...p} />
)

export function AttendeesRow({ emails, draft, onDraft, onAdd, onRemove }: {
  emails: string[]; draft: string; onDraft: (v: string) => void; onAdd: () => void; onRemove: (email: string) => void
}) {
  return (
    <Row icon={Users}>
      {emails.length > 0 && (
        <div className="meow-ef-chips">
          {emails.map((email) => (
            <span key={email} className="meow-ef-chip">
              {email}
              <button type="button" onClick={() => onRemove(email)} aria-label={`Remove ${email}`}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <span className="meow-ef-inline">
        <input
          type="email"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onAdd()
            }
          }}
          placeholder="Add attendee"
          aria-label="Add attendee"
          className="meow-ef-input is-wide"
        />
        <button type="button" onClick={onAdd} className="meow-ef-iconbtn" aria-label="Add attendee email"><Plus size={14} /></button>
      </span>
    </Row>
  )
}

function reminderWords(reminders: { minutes_before: number }[]): string {
  if (reminders.length === 0) return 'No reminders'
  const one = (m: number) => (m === 0 ? 'At start' : m < 60 ? `${m}m` : m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`)
  return `${[...reminders].sort((a, b) => a.minutes_before - b.minutes_before).map((r) => one(r.minutes_before)).join(', ')} before`
}

/** Reminders, busy/free and privacy as one summary line; opening it shows the controls. */
export function SettingsRow({ reminders, onReminders, visibility, onVisibility, privacy, onPrivacy }: {
  reminders: { minutes_before: number }[]
  onReminders: (r: { minutes_before: number }[]) => void
  visibility: 'busy' | 'free'
  onVisibility: (v: 'busy' | 'free') => void
  privacy: 'public' | 'private'
  onPrivacy: (v: 'public' | 'private') => void
}) {
  const [open, setOpen] = React.useState(false)
  const summary = [reminderWords(reminders), visibility === 'busy' ? 'Busy' : 'Free', privacy === 'public' ? 'Public' : 'Private']
  return (
    <Row icon={Bell}>
      <button type="button" className="meow-ef-link is-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        {summary.join(' · ')}
      </button>
      {open && (
        <div className="meow-ef-sub space-y-3">
          <ReminderEditor reminders={reminders} onChange={onReminders} />
          <div className="grid grid-cols-2 gap-3">
            <ToggleGroup options={[{ value: 'busy', label: 'Busy', icon: Eye }, { value: 'free', label: 'Free', icon: Zap }]} value={visibility} onChange={(v) => onVisibility(v as 'busy' | 'free')} />
            <ToggleGroup options={[{ value: 'public', label: 'Public', icon: Globe }, { value: 'private', label: 'Private', icon: Lock }]} value={privacy} onChange={(v) => onPrivacy(v as 'public' | 'private')} />
          </div>
        </div>
      )}
    </Row>
  )
}

export function ImportanceRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Row icon={Flag}>
      <div className="meow-ef-seg" role="group" aria-label="Importance">
        {IMPORTANCE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            className={cn(value === opt.value && 'is-on')}
            style={value === opt.value ? ({ '--ic': opt.color } as React.CSSProperties) : undefined}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Row>
  )
}

export function EstimateLine({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <BlockLine label="Estimate" htmlFor="ef-estimate">
      <span className="meow-ef-inline">
        <Timer size={14} strokeWidth={1.6} className="text-[var(--mut)]" aria-hidden="true" />
        <input id="ef-estimate" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder='e.g. "60m" or "2h"' className="meow-ef-input" />
      </span>
    </BlockLine>
  )
}

export function SubtasksRow(props: React.ComponentProps<typeof SubtaskList>) {
  return (
    <Row icon={ListChecks}>
      <SubtaskList {...props} />
    </Row>
  )
}

export function TagsRow({ tags, selected, onToggle }: { tags: Tag[]; selected: Tag[]; onToggle: (t: Tag) => void }) {
  if (tags.length === 0) return null
  return (
    <Row icon={TagIcon}>
      <div className="meow-ef-chips">
        {tags.map((tag) => {
          const on = selected.some((t) => t.id === tag.id)
          return (
            <button key={tag.id} type="button" onClick={() => onToggle(tag)} aria-pressed={on} className={cn('meow-ef-tag', on && 'is-on')} style={{ '--tc': tag.color } as React.CSSProperties}>
              {tag.prefix ? `${tag.prefix} ${tag.name}` : tag.name}
            </button>
          )
        })}
      </div>
    </Row>
  )
}

