'use client'

import { useState } from 'react'
import { Mail, RefreshCw, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SettingsSection, SettingsToggle } from './SettingsSection'
import type { GoogleAccount, Calendar as CalendarType } from '@poolendar/types'

interface CalendarsTabProps {
  googleAccounts: GoogleAccount[]
  calendars: CalendarType[]
  onConnect: () => void
  onDisconnect: (id: string) => void
  onToggleCalendar: (id: string, active: boolean) => void
  onResync: (accountId: string) => Promise<void>
  onCreateLocal: (name: string) => void
  onRenameLocal: (id: string, name: string) => void
  onDeleteLocal: (id: string) => void
  taskSyncCalendarId: string | null
  onTaskSyncChange: (calendarId: string | null) => void
}

export function CalendarsTab({
  googleAccounts,
  calendars,
  onConnect,
  onDisconnect,
  onToggleCalendar,
  onResync,
  onCreateLocal,
  onRenameLocal,
  onDeleteLocal,
  taskSyncCalendarId,
  onTaskSyncChange,
}: CalendarsTabProps) {
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [syncingIds, setSyncingIds] = useState<Set<string>>(() => new Set())

  async function resync(accountId: string) {
    if (syncingIds.has(accountId)) return
    setSyncingIds((ids) => new Set(ids).add(accountId))
    try {
      await onResync(accountId)
    } finally {
      setSyncingIds((ids) => { const next = new Set(ids); next.delete(accountId); return next })
    }
  }
  const [newLocalName, setNewLocalName] = useState('')
  const localCalendars = calendars.filter((c) => c.source === 'local')
  const writableGoogleCalendars = calendars.filter(
    (c) => c.source === 'google' && (c.access_role === 'owner' || c.access_role === 'writer'),
  )

  return (
    <>
      <SettingsSection
        title="Local Calendars"
        description="These live in Meowlendar only. No Google account needed."
      >
        {localCalendars.map((calendar) => (
          <div
            key={calendar.id}
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          >
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} />
            <input
              aria-label={`Name of ${calendar.name}`}
              defaultValue={calendar.name}
              maxLength={100}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name && name !== calendar.name) onRenameLocal(calendar.id, name)
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--fg)] outline-none"
            />
            <SettingsToggle
              label={`Show ${calendar.name}`}
              checked={calendar.is_active}
              onChange={(active) => onToggleCalendar(calendar.id, active)}
            />
            {localCalendars.length > 1 && (
              <button
                onClick={() => {
                  if (window.confirm(`Delete ${calendar.name} and all its events?`)) {
                    onDeleteLocal(calendar.id)
                  }
                }}
                aria-label={`Delete ${calendar.name}`}
                className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--destructive)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            aria-label="New local calendar name"
            placeholder="New calendar name"
            value={newLocalName}
            maxLength={100}
            onChange={(e) => setNewLocalName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!newLocalName.trim()}
            onClick={() => {
              onCreateLocal(newLocalName.trim())
              setNewLocalName('')
            }}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Connected Accounts"
        description="Connect Google accounts to sync calendars"
      >
        {googleAccounts.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            No Google accounts connected.
          </p>
        )}

        {googleAccounts.map((account) => {
          const accountCalendars = calendars.filter(
            (c) => c.google_account_id === account.id
          )

          return (
            <div
              key={account.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)]"
            >
              {/* Account header */}
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-[var(--muted)]" />
                  <div>
                    <div className="text-sm font-medium text-[var(--fg)]">
                      {account.email}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {account.last_synced_at
                        ? `Last synced ${new Date(account.last_synced_at).toLocaleString()}`
                        : 'Never synced'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void resync(account.id) }}
                    disabled={syncingIds.has(account.id)}
                    aria-busy={syncingIds.has(account.id)}
                    className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
                    aria-label={syncingIds.has(account.id) ? "Syncing account" : "Resync account"}
                    title={syncingIds.has(account.id) ? "Syncing" : "Resync"}
                  >
                    <RefreshCw className={syncingIds.has(account.id) ? "h-4 w-4 animate-spin motion-reduce:animate-none" : "h-4 w-4"} />
                  </button>
                  {disconnectingId === account.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          onDisconnect(account.id)
                          setDisconnectingId(null)
                        }}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDisconnectingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDisconnectingId(account.id)}
                      className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--destructive)]"
                      aria-label="Disconnect account"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Calendar list */}
              <div className="divide-y divide-[var(--border)]">
                {accountCalendars.map((cal) => (
                  <div
                    key={cal.id}
                    className="flex items-center justify-between px-4 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: cal.color }}
                      />
                      <span className="text-sm text-[var(--fg)]">
                        {cal.name}
                      </span>
                      {cal.is_primary && (
                        <span className="rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                          Primary
                        </span>
                      )}
                    </div>
                    <SettingsToggle
                      checked={cal.is_active}
                      onChange={(active) => onToggleCalendar(cal.id, active)}
                      label={`Toggle ${cal.name}`}
                    />
                  </div>
                ))}
                {accountCalendars.length === 0 && (
                  <div className="px-4 py-3 text-xs text-[var(--muted)]">
                    No calendars found. Try resyncing.
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <Button onClick={onConnect} variant="outline" size="sm">
          <Plus className="h-4 w-4" />
          Connect Google Account
        </Button>
      </SettingsSection>

      {writableGoogleCalendars.length > 0 && (
        <SettingsSection
          title="Tasks on Google"
          description="Scheduled tasks can appear on a Google calendar and stay updated. Changes made on Google come back to the task."
        >
          <label className="flex flex-col gap-1 text-sm text-[var(--fg)]">
            Send scheduled tasks to
            <select
              aria-label="Send scheduled tasks to"
              value={taskSyncCalendarId ?? ''}
              onChange={(e) => onTaskSyncChange(e.target.value || null)}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)]"
            >
              <option value="">Off</option>
              {writableGoogleCalendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </SettingsSection>
      )}
    </>
  )
}
