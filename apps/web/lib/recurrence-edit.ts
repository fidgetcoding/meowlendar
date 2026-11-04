import type { SupabaseClient } from '@supabase/supabase-js'
import { omit } from './omit'
import { ruleEndingBefore, ruleWithoutCount } from './recurrence'

// Edits and deletes that touch part of a recurring series. Works on any calendar:
// a Google-backed series gets marked pending_push, so the sync job carries the new
// rule and its EXDATE lines across.

export type RecurrenceScope = 'single' | 'future' | 'all' | 'custom'

interface SeriesRow {
  updated_at: string
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

function exceptions(master: SeriesRow, dates: string[]) {
  return [...new Set([...(master.recurrence_exceptions ?? []), ...dates].map(iso => new Date(iso).toISOString()))]
}

async function mutate(supabase: SupabaseClient, master: SeriesRow, patch: Patch, inserts: Patch[] = [], remove = false) {
  const { data, error } = await supabase.rpc('mutate_event_series', {
    p_id: master.id, p_expected_updated_at: master.updated_at,
    p_patch: patch, p_inserts: inserts, p_delete: remove,
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data
}

export async function applyScopedEdit(
  supabase: SupabaseClient, master: SeriesRow,
  options: { scope: RecurrenceScope; occurrenceStart?: string; dates?: string[]; patch: Patch },
): Promise<unknown> {
  const { scope, occurrenceStart, dates, patch } = options
  if (scope === 'single' || scope === 'custom') {
    const selected = [...new Set(scope === 'single' ? [occurrenceStart as string] : dates ?? [])]
    const inserts = selected.map(date => ({
      ...copyOf(master), start_time: new Date(date).toISOString(),
      end_time: new Date(new Date(date).getTime() + durationMs(master)).toISOString(),
      recurrence_rule: null, recurrence_id: master.id,
      ...(scope === 'custom' ? omit(patch, ['start_time', 'end_time']) : patch),
    }))
    return mutate(supabase, master, { recurrence_exceptions: exceptions(master, selected) }, inserts)
  }
  if (scope === 'future') {
    const start = new Date(occurrenceStart as string)
    return mutate(supabase, master, {
      recurrence_rule: ruleEndingBefore(master.recurrence_rule as string, start),
    }, [{
      ...copyOf(master), start_time: start.toISOString(),
      end_time: new Date(start.getTime() + durationMs(master)).toISOString(),
      recurrence_rule: ruleWithoutCount(master.recurrence_rule as string),
      recurrence_exceptions: (master.recurrence_exceptions ?? []).filter(iso => new Date(iso) > start),
      ...patch,
    }])
  }
  const update: Patch = { ...patch }
  if (occurrenceStart && typeof patch.start_time === 'string') {
    const delta = new Date(patch.start_time).getTime() - new Date(occurrenceStart).getTime()
    const newStart = new Date(new Date(master.start_time).getTime() + delta)
    const length = typeof patch.end_time === 'string'
      ? new Date(patch.end_time).getTime() - new Date(patch.start_time).getTime() : durationMs(master)
    update.start_time = newStart.toISOString()
    update.end_time = new Date(newStart.getTime() + length).toISOString()
    update.recurrence_exceptions = (master.recurrence_exceptions ?? []).map(iso => new Date(new Date(iso).getTime() + delta).toISOString())
  }
  return mutate(supabase, master, update)
}

export async function applyScopedDelete(
  supabase: SupabaseClient, master: SeriesRow,
  options: { scope: RecurrenceScope; occurrenceStart?: string; dates?: string[] },
): Promise<{ deleteMaster: boolean }> {
  const { scope, occurrenceStart, dates } = options
  if (scope === 'single' || scope === 'custom') {
    await mutate(supabase, master, { recurrence_exceptions: exceptions(master, scope === 'single' ? [occurrenceStart as string] : dates ?? []) })
    return { deleteMaster: false }
  }
  if (scope === 'future' && new Date(occurrenceStart as string) > new Date(master.start_time)) {
    await mutate(supabase, master, { recurrence_rule: ruleEndingBefore(master.recurrence_rule as string, new Date(occurrenceStart as string)) })
    return { deleteMaster: false }
  }
  return { deleteMaster: true }
}

/** Delete a master and all detached rows atomically; DB tombstones retain Google cleanup. */
export async function deleteEventSeries(supabase: SupabaseClient, master: SeriesRow): Promise<void> {
  await mutate(supabase, master, {}, [], true)
}
