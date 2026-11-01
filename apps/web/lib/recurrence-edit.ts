import type { SupabaseClient } from '@supabase/supabase-js'
import { omit } from './omit'
import { ruleEndingBefore, ruleWithoutCount } from './recurrence'

// Edits and deletes that touch part of a recurring series. Works on any calendar:
// a Google-backed series gets marked pending_push, so the sync job carries the new
// rule and its EXDATE lines across.

export type RecurrenceScope = 'single' | 'future' | 'all' | 'custom'

interface SeriesRow {
  id: string
  user_id: string
  calendar_id: string
  title: string
  notes: string | null
  start_time: string
  end_time: string
  timezone: string
  is_all_day: boolean
  location: string | null
  color_override: string | null
  visibility: string
  privacy: string
  conferencing_url: string | null
  recurrence_rule: string | null
  recurrence_exceptions: string[] | null
  attendees: unknown
  reminders: unknown
  status: string
}

type Patch = Record<string, unknown>

const COPIED_FIELDS = [
  'user_id',
  'calendar_id',
  'title',
  'notes',
  'timezone',
  'is_all_day',
  'location',
  'color_override',
  'visibility',
  'privacy',
  'conferencing_url',
  'attendees',
  'reminders',
  'status',
] as const

function copyOf(master: SeriesRow): Patch {
  const row: Patch = {}
  for (const field of COPIED_FIELDS) row[field] = master[field]
  return row
}

function durationMs(master: SeriesRow): number {
  return new Date(master.end_time).getTime() - new Date(master.start_time).getTime()
}

async function addExceptions(
  supabase: SupabaseClient,
  master: SeriesRow,
  occurrences: string[],
): Promise<void> {
  const merged = [
    ...new Set([
      ...(master.recurrence_exceptions ?? []).map((iso) => new Date(iso).toISOString()),
      ...occurrences.map((iso) => new Date(iso).toISOString()),
    ]),
  ]
  const { error } = await supabase
    .from('events')
    .update({ recurrence_exceptions: merged, sync_status: 'pending_push' })
    .eq('id', master.id)
  if (error) throw new Error('Failed to update the series')
  master.recurrence_exceptions = merged
}

/** Pulls one occurrence out of the series as its own event, with `patch` applied. */
async function detachOccurrence(
  supabase: SupabaseClient,
  master: SeriesRow,
  occurrenceStart: string,
  patch: Patch,
): Promise<unknown> {
  await addExceptions(supabase, master, [occurrenceStart])
  const start = new Date(occurrenceStart)
  const { data, error } = await supabase
    .from('events')
    .insert({
      ...copyOf(master),
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + durationMs(master)).toISOString(),
      recurrence_rule: null,
      recurrence_id: master.id,
      sync_status: 'pending_push',
      ...patch,
    })
    .select()
    .single()
  if (error) throw new Error('Failed to create the changed occurrence')
  return data
}

/** Ends the series before `occurrenceStart` and continues it as a new one. */
async function splitSeries(
  supabase: SupabaseClient,
  master: SeriesRow,
  occurrenceStart: string,
  patch: Patch,
): Promise<unknown> {
  const start = new Date(occurrenceStart)
  const rule = master.recurrence_rule as string

  const { data, error } = await supabase
    .from('events')
    .insert({
      ...copyOf(master),
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + durationMs(master)).toISOString(),
      recurrence_rule: ruleWithoutCount(rule),
      recurrence_exceptions: (master.recurrence_exceptions ?? []).filter(
        (iso) => new Date(iso) > start,
      ),
      sync_status: 'pending_push',
      ...patch,
    })
    .select()
    .single()
  if (error) throw new Error('Failed to create the new series')

  await endSeries(supabase, master, start)
  return data
}

async function endSeries(supabase: SupabaseClient, master: SeriesRow, before: Date): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      recurrence_rule: ruleEndingBefore(master.recurrence_rule as string, before),
      sync_status: 'pending_push',
    })
    .eq('id', master.id)
  if (error) throw new Error('Failed to shorten the series')
}

/**
 * Applies `patch` to part of a series. `patch` holds the new values, with any
 * start and end given for the occurrence being edited.
 */
export async function applyScopedEdit(
  supabase: SupabaseClient,
  master: SeriesRow,
  options: { scope: RecurrenceScope; occurrenceStart?: string; dates?: string[]; patch: Patch },
): Promise<unknown> {
  const { scope, occurrenceStart, dates, patch } = options

  if (scope === 'single') {
    return detachOccurrence(supabase, master, occurrenceStart as string, patch)
  }
  if (scope === 'future') {
    return splitSeries(supabase, master, occurrenceStart as string, patch)
  }
  if (scope === 'custom') {
    let last: unknown = null
    for (const date of dates ?? []) {
      // New times only make sense for one occurrence, so a set keeps its own.
      last = await detachOccurrence(supabase, master, date, omit(patch, ['start_time', 'end_time']))
    }
    return last
  }

  // scope 'all': new times given for one occurrence shift the whole series.
  const update: Patch = { ...patch, sync_status: 'pending_push' }
  if (occurrenceStart && typeof patch.start_time === 'string') {
    const delta = new Date(patch.start_time).getTime() - new Date(occurrenceStart).getTime()
    const newStart = new Date(new Date(master.start_time).getTime() + delta)
    const length =
      typeof patch.end_time === 'string'
        ? new Date(patch.end_time).getTime() - new Date(patch.start_time).getTime()
        : durationMs(master)
    update.start_time = newStart.toISOString()
    update.end_time = new Date(newStart.getTime() + length).toISOString()
    // Exceptions are pinned to old start times, so they move with the series.
    update.recurrence_exceptions = (master.recurrence_exceptions ?? []).map((iso) =>
      new Date(new Date(iso).getTime() + delta).toISOString(),
    )
  }
  const { data, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', master.id)
    .select()
    .single()
  if (error) throw new Error('Failed to update the series')
  return data
}

/** Removes part of a series. Returns true when the whole master row should go too. */
export async function applyScopedDelete(
  supabase: SupabaseClient,
  master: SeriesRow,
  options: { scope: RecurrenceScope; occurrenceStart?: string; dates?: string[] },
): Promise<{ deleteMaster: boolean }> {
  const { scope, occurrenceStart, dates } = options
  if (scope === 'single') {
    await addExceptions(supabase, master, [occurrenceStart as string])
    return { deleteMaster: false }
  }
  if (scope === 'custom') {
    await addExceptions(supabase, master, dates ?? [])
    return { deleteMaster: false }
  }
  if (scope === 'future') {
    const before = new Date(occurrenceStart as string)
    // Deleting from the first occurrence on leaves nothing of the series.
    if (before.getTime() <= new Date(master.start_time).getTime()) return { deleteMaster: true }
    await endSeries(supabase, master, before)
    return { deleteMaster: false }
  }
  return { deleteMaster: true }
}
