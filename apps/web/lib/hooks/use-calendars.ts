'use client'

import { useQuery } from '@tanstack/react-query'
import type { Calendar } from '@poolendar/types'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const calendarKeys = {
  all: ['calendars'] as const,
  list: () => [...calendarKeys.all, 'list'] as const,
}

// ---------------------------------------------------------------------------
// GET /api/calendars response shape — accounts grouped with sub-calendars
// ---------------------------------------------------------------------------

export interface CalendarAccountGroup {
  id: string
  email: string
  token_expires_at: string
  sync_token: string | null
  last_synced_at: string | null
  created_at: string
  calendars: Calendar[]
}

interface CalendarsResponse {
  accounts: CalendarAccountGroup[]
  local_calendars?: Calendar[]
}

/**
 * Flatten the account-grouped response into a single list of sub-calendars.
 * Pure so it can be unit-tested without the network.
 */
export function flattenCalendars(
  accounts: CalendarAccountGroup[] | undefined | null,
  localCalendars?: Calendar[] | null
): Calendar[] {
  return [
    ...(accounts ?? []).flatMap((account) => account.calendars ?? []),
    ...(localCalendars ?? []),
  ]
}

/** The calendar a new event goes on when none was chosen: the primary one, else the first turned on. */
export function defaultCalendarOf(calendars: readonly Calendar[] | undefined): string | null {
  const active = (calendars ?? []).filter((c) => c.is_active !== false)
  return (active.find((c) => c.is_primary) ?? active[0])?.id ?? null
}

// ---------------------------------------------------------------------------
// useCalendars — flat list of every calendar: Google sub-calendars, then local
// ---------------------------------------------------------------------------

export function useCalendars() {
  return useQuery({
    queryKey: calendarKeys.list(),
    queryFn: async (): Promise<Calendar[]> => {
      const res = await fetch('/api/calendars')
      if (!res.ok) {
        throw new Error(`Failed to load calendars (${res.status})`)
      }
      const json = (await res.json()) as CalendarsResponse
      return flattenCalendars(json.accounts, json.local_calendars)
    },
  })
}

/**
 * useCalendarAccounts — the account-grouped response, for settings and the
 * account panel where the email → sub-calendar grouping matters.
 */
export function useCalendarAccounts() {
  return useQuery({
    queryKey: [...calendarKeys.all, 'accounts'] as const,
    queryFn: async (): Promise<CalendarAccountGroup[]> => {
      const res = await fetch('/api/calendars')
      if (!res.ok) {
        throw new Error(`Failed to load calendars (${res.status})`)
      }
      const json = (await res.json()) as CalendarsResponse
      return json.accounts ?? []
    },
  })
}
