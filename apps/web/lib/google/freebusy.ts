// Google freeBusy lookup for booking availability (spec #56). Busy times from
// the host's connected Google calendar are subtracted from bookable slots IN
// ADDITION to local bookings + events. This path CANNOT be live-verified under
// the standing directive (no Google OAuth), so it is written to be trivially
// mockable and to degrade gracefully: no connected account → skip; any failure
// → log once and return no busy periods (never throw, never block booking).
import { getGoogleAccessToken } from './calendar'
import type { BusyPeriod } from '../booking/availability'
import { googleApiBase } from '../external-urls'

let warned = false
function warnOnce(context: string, err: unknown): void {
  if (warned) return
  warned = true
  console.warn(`[google/freebusy] degraded (${context}):`, err)
}

/** Reset the once-only warning latch. Test-only. */
export function __resetFreeBusyWarn(): void {
  warned = false
}

/**
 * Return the host's Google busy periods over [timeMin, timeMax). Returns [] when
 * no account is connected or on any error. `hasConnectedAccount` is the guard the
 * caller uses to decide whether Google should be consulted at all.
 */
export async function getGoogleBusyPeriods(opts: {
  googleAccountId: string | null | undefined
  timeMin: Date
  timeMax: Date
  calendarId?: string
}): Promise<BusyPeriod[]> {
  if (!opts.googleAccountId) return []

  try {
    const accessToken = await getGoogleAccessToken(opts.googleAccountId)
    const res = await fetch(`${googleApiBase()}/calendar/v3/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: opts.timeMin.toISOString(),
        timeMax: opts.timeMax.toISOString(),
        items: [{ id: opts.calendarId ?? 'primary' }],
      }),
    })

    if (!res.ok) {
      warnOnce(`freeBusy ${res.status}`, await res.text().catch(() => ''))
      return []
    }

    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>
    }
    const periods: BusyPeriod[] = []
    for (const cal of Object.values(data.calendars ?? {})) {
      for (const b of cal.busy ?? []) {
        if (b.start && b.end) periods.push({ start: b.start, end: b.end })
      }
    }
    return periods
  } catch (err) {
    warnOnce('request failed', err)
    return []
  }
}
