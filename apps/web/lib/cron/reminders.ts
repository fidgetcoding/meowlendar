// SERVICE ROLE: Required. Runs with no user, and needs cross-user access to events,
// tasks, routines and push subscriptions.
import { createServerClient } from '@supabase/ssr'
import { dispatchNotification } from '@/lib/notifications/dispatcher'
import { eventsInWindowFilter, expandOccurrences } from '@/lib/recurrence'

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } }
  )
}

/** True when the reminder fires within the next 60 seconds. */
function isReminderDue(startIso: string, minutesBefore: number, now: Date): boolean {
  const reminderAt = new Date(startIso).getTime() - minutesBefore * 60_000
  return reminderAt >= now.getTime() && reminderAt < now.getTime() + 60_000
}

function minutesLabel(m: number): string {
  return m === 0 ? 'now' : `in ${m} min`
}

/** Minute-bucket dedup key so the 1-minute cron interval never double-sends. */
function dedupKey(type: string, id: string, minBefore: number, startIso: string): string {
  const bucket = new Date(new Date(startIso).getTime() - minBefore * 60_000)
    .toISOString().slice(0, 16)
  return `${type}:${id}:${minBefore}:${bucket}`
}

/** Check whether a dedup key has already been recorded in `sent_reminders`. */
async function alreadySent(
  supabase: ReturnType<typeof getServiceClient>,
  key: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('sent_reminders')
    .select('id')
    .eq('dedup_key', key)
    .limit(1)
    .single()
  return !!data
}

/** Record a dedup key after successfully sending a reminder. */
async function markSent(
  supabase: ReturnType<typeof getServiceClient>,
  key: string,
): Promise<void> {
  await supabase
    .from('sent_reminders')
    .upsert({ dedup_key: key }, { onConflict: 'dedup_key' })
}

/** Delete dedup entries older than 24 hours. */
async function cleanupStaleEntries(
  supabase: ReturnType<typeof getServiceClient>,
): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  await supabase
    .from('sent_reminders')
    .delete()
    .lt('sent_at', cutoff)
}

/** Sends reminders due in the next minute. Safe to run repeatedly. */
export async function runReminders(): Promise<{ success: true; processed: number }> {
  const supabase = getServiceClient()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 60 * 60_000)
  let processed = 0

  // Garbage-collect stale dedup rows before processing
  await cleanupStaleEntries(supabase)

  // --- Events ---
  const { data: events } = await supabase
    .from('events')
    .select('id, user_id, title, start_time, end_time, timezone, is_all_day, recurrence_rule, recurrence_exceptions, reminders, location, conferencing_url')
    .not('reminders', 'eq', '[]')
    .or(eventsInWindowFilter(now.toISOString(), windowEnd.toISOString()))
    .neq('status', 'cancelled')

  for (const ev of events ?? []) {
    for (const occurrence of expandOccurrences(ev, now, windowEnd)) {
      const startIso = occurrence.start.toISOString()
      for (const r of (ev.reminders as { minutes_before: number }[]) ?? []) {
        if (!isReminderDue(startIso, r.minutes_before, now)) continue
        const key = dedupKey('event', ev.id, r.minutes_before, startIso)
        if (await alreadySent(supabase, key)) continue
        await dispatchNotification(supabase, ev.user_id, {
          title: `Event ${minutesLabel(r.minutes_before)}`,
          body: ev.title,
          event: 'event_reminder',
          url: '/',
          data: { event_id: ev.id, minutes_before: r.minutes_before,
            location: ev.location, conferencing_url: ev.conferencing_url },
        })
        await markSent(supabase, key)
        processed++
      }
    }
  }

  // --- Tasks ---
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, user_id, title, scheduled_start, due_date, reminders')
    .not('reminders', 'eq', '[]')
    .neq('status', 'done')
    .or(`scheduled_start.gte.${now.toISOString()},due_date.gte.${now.toISOString().slice(0, 10)}`)

  for (const t of tasks ?? []) {
    const ref = t.scheduled_start ?? (t.due_date ? `${t.due_date}T09:00:00` : null)
    if (!ref || new Date(ref) > windowEnd) continue
    for (const r of (t.reminders as { minutes_before: number }[]) ?? []) {
      if (!isReminderDue(ref, r.minutes_before, now)) continue
      const key = dedupKey('task', t.id, r.minutes_before, ref)
      if (await alreadySent(supabase, key)) continue
      await dispatchNotification(supabase, t.user_id, {
        title: `Task due ${minutesLabel(r.minutes_before)}`,
        body: t.title,
        event: 'task_reminder',
        data: { task_id: t.id, minutes_before: r.minutes_before },
      })
      await markSent(supabase, key)
      processed++
    }
  }

  // --- Routine instances for today ---
  const todayStr = now.toISOString().slice(0, 10)
  const { data: instances } = await supabase
    .from('routine_instances')
    .select(`
      id, routine_id, date, status, override_start_time,
      routines!inner (id, user_id, title, start_time, reminders, timezone)
    `)
    .eq('date', todayStr)
    .eq('status', 'pending')

  for (const inst of instances ?? []) {
    const routine = inst.routines as unknown as {
      id: string; user_id: string; title: string
      start_time: string; reminders: { minutes_before: number }[]
    }
    if (!routine?.reminders?.length) continue
    const fullStart = `${inst.date}T${inst.override_start_time ?? routine.start_time}`
    const startDate = new Date(fullStart)
    if (startDate > windowEnd || startDate < now) continue

    for (const r of routine.reminders) {
      if (!isReminderDue(fullStart, r.minutes_before, now)) continue
      const key = dedupKey('routine', inst.id, r.minutes_before, fullStart)
      if (await alreadySent(supabase, key)) continue
      await dispatchNotification(supabase, routine.user_id, {
        title: `Routine ${minutesLabel(r.minutes_before)}`,
        body: routine.title,
        event: 'routine_reminder',
        data: { routine_id: routine.id, instance_id: inst.id,
          minutes_before: r.minutes_before },
      })
      await markSent(supabase, key)
      processed++
    }
  }

  return { success: true, processed }
}
