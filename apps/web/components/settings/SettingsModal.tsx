'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X,
  ChevronLeft,
  Keyboard,
  Video,
  Send,
  Settings,
  Tag,
  Clock,
  ExternalLink,
  User,
  Key,
  Calendar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { GeneralTab } from './GeneralTab'
import { NotificationsTab } from './NotificationsTab'
import { AccountTab } from './AccountTab'
import { ApiKeyManager } from './ApiKeyManager'
import { ShortcutsTab } from './ShortcutsTab'
import { TagsTab } from './TagsTab'
import { AvailabilityTab } from './AvailabilityTab'
import { BookingPagesTab } from './BookingPagesTab'
import { VideoConferencingTab } from './VideoConferencingTab'
import { TelegramTab } from './TelegramTab'
import { CalendarsTab } from './CalendarsTab'
import { createClient } from '@/lib/supabase/client'
import { omit } from '@/lib/omit'
import { toast } from 'sonner'
import type {
  Profile,
  UserSettings,
  NotificationSettings,
  ApiKey,
  GoogleAccount,
  Calendar as CalendarType,
} from '@poolendar/types'
import { useQueryClient } from '@tanstack/react-query'
import { calendarKeys } from '@/lib/hooks/use-calendars'
import { eventKeys } from '@/lib/hooks/use-events'

export type SettingsTab =
  | 'shortcuts'
  | 'video'
  | 'telegram'
  | 'calendars'
  | 'general'
  | 'notifications'
  | 'tags'
  | 'availability'
  | 'booking'
  | 'profile'
  | 'api-keys'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: Profile | null
  onProfileUpdate: (profile: Profile) => void
  /** When set, the modal opens focused on this tab (deep-link from command bar / panels). */
  initialTab?: SettingsTab
}

const DEFAULT_SETTINGS: UserSettings = {
  default_event_calendar_id: null,
  default_task_calendar_id: null,
  privacy_default: 'private',
  busy_free_default: 'busy',
  move_due_date_behavior: 'ask',
  auto_assign_due_dates: false,
  timezone: 'America/New_York',
  time_format: '12h',
  language: 'en',
  first_day_of_week: 'sunday',
  initial_view: 'week',
  theme_accent_color: '#f9a825',
  time_grid_start: '00:00',
  time_grid_end: '24:00',
  time_display_resolution: 15,
  time_drag_resolution: 15,
  default_task_duration_minutes: 30,
  limit_events_per_day: 4,
  undo_grace_period_seconds: 30,
  show_weekends: true,
  widen_current_day: true,
  dim_past_events: true,
  show_completed_tasks: true,
  show_declined_events: false,
  merge_duplicate_events: true,
  background_density: 'comfortable',
  notifications: {
    browser_push: { enabled: true, reminders: true, due_dates: true, bookings: true, schedule_changes: true },
    email: { enabled: false, reminders: false, due_dates: false, bookings: false, schedule_changes: false },
    in_app: { enabled: true, reminders: true, due_dates: true, bookings: true, schedule_changes: true },
    telegram: { enabled: false, reminders: false, due_dates: false, bookings: false, schedule_changes: false },
  },
  telegram_chat_id: null,
  booking_page_title: null,
  booking_page_welcome: null,
  booking_page_brand_color: null,
  booking_page_logo_url: null,
  booking_page_show_poolendar_branding: true,
}

interface NavItem {
  key: SettingsTab
  label: string
  icon: typeof Settings
}

interface NavSection {
  label: string
  items: NavItem[]
}

const SETTINGS_SECTIONS: NavSection[] = [
  {
    label: 'Explore',
    items: [{ key: 'shortcuts', label: 'Shortcuts', icon: Keyboard }],
  },
  {
    label: 'Integrations',
    items: [
      { key: 'calendars', label: 'Calendars', icon: Calendar },
      { key: 'video', label: 'Video Conferencing', icon: Video },
      { key: 'telegram', label: 'Telegram', icon: Send },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { key: 'general', label: 'General', icon: Settings },
      { key: 'notifications', label: 'Notifications', icon: Settings },
      { key: 'tags', label: 'Tags', icon: Tag },
      { key: 'availability', label: 'Availability', icon: Clock },
      { key: 'booking', label: 'Booking Pages', icon: ExternalLink },
    ],
  },
  {
    label: 'Account',
    items: [
      { key: 'profile', label: 'Profile', icon: User },
      { key: 'api-keys', label: 'API Keys', icon: Key },
    ],
  },
]

function findTabLabel(tab: SettingsTab): string {
  for (const section of SETTINGS_SECTIONS) {
    for (const item of section.items) {
      if (item.key === tab) return item.label
    }
  }
  return ''
}

export function SettingsModal({
  open,
  onOpenChange,
  profile,
  onProfileUpdate,
  initialTab,
}: SettingsModalProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<SettingsTab>('shortcuts')

  // Deep-link: focus the requested tab whenever the modal (re)opens.
  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab)
      setMobileNavOpen(false)
    }
  }, [open, initialTab])
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([])
  const [calendars, setCalendars] = useState<CalendarType[]>([])
  const [saving, setSaving] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(true)

  // Profile editing state
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [company, setCompany] = useState('')

  const loadApiKeys = useCallback(async () => {
    const { data } = await supabase
      .from('api_keys')
      .select('id, user_id, name, key_prefix, last_used_at, created_at')
      .order('created_at', { ascending: false })
    if (data) setApiKeys(data)
  }, [supabase])

  // Load settings when modal opens
  useEffect(() => {
    if (!open || !profile) return

    setSettings({ ...DEFAULT_SETTINGS, ...profile.settings })
    setDisplayName(profile.display_name || '')
    setUsername(profile.username || '')
    setCompany(profile.company || '')

    loadApiKeys()
    loadCalendars()
  }, [open, profile, loadApiKeys])

  async function loadCalendars() {
    try {
      const res = await fetch('/api/calendars')
      if (!res.ok) return
      const { accounts, local_calendars: localCalendars } = (await res.json()) as {
        accounts: (GoogleAccount & { calendars: CalendarType[] })[]
        local_calendars?: CalendarType[]
      }
      setGoogleAccounts(
        accounts.map((account) => omit(account, ['calendars']))
      )
      setCalendars([...accounts.flatMap((a) => a.calendars ?? []), ...(localCalendars ?? [])])
    } catch {
      // Non-fatal — the tab shows an empty state until reloaded.
    }
  }

  function handleConnectCalendar() {
    // Browser GET redirect flow (sets the CSRF nonce cookie).
    window.location.href = '/api/google/connect'
  }

  async function handleDisconnectAccount(accountId: string) {
    const res = await fetch(`/api/google/disconnect/${accountId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      toast.success('Google account disconnected')
      loadCalendars()
    } else {
      toast.error('Failed to disconnect account')
    }
  }

  async function handleToggleCalendar(calendarId: string, active: boolean) {
    const res = await fetch(`/api/calendars/${calendarId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active }),
    })
    if (res.ok) {
      loadCalendars()
    } else {
      toast.error('Failed to update calendar')
    }
  }

  async function changeLocalCalendar(url: string, method: string, body?: unknown, failure = 'Failed to update calendar') {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.ok) {
      loadCalendars()
      queryClient.invalidateQueries({ queryKey: calendarKeys.all })
    } else {
      toast.error(failure)
    }
  }

  async function handleResyncAccount(accountId: string) {
    try {
      const res = await fetch('/api/google/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_account_id: accountId }),
      })
      if (!res.ok) throw new Error('Resync failed')
      await loadCalendars()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
        queryClient.invalidateQueries({ queryKey: eventKeys.all }),
      ])
      toast.success('Calendar resynced')
    } catch {
      toast.error('Resync failed')
    }
  }

  function updateSettings(partial: Partial<UserSettings>) {
    setSettings((s) => ({ ...s, ...partial }))
  }

  function updateNotifications(
    channel: keyof NotificationSettings,
    key: string,
    value: boolean
  ) {
    setSettings((s) => ({
      ...s,
      notifications: {
        ...s.notifications,
        [channel]: {
          ...s.notifications[channel],
          [key]: value,
        },
      },
    }))
  }

  const saveSettings = useCallback(async () => {
    if (!profile) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          settings,
          display_name: displayName || null,
          username,
          company: company || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id)

      if (error) {
        toast.error('Failed to save settings')
        return
      }

      onProfileUpdate({
        ...profile,
        settings,
        display_name: displayName || null,
        username,
        company: company || null,
      })
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [profile, settings, displayName, username, company, supabase, onProfileUpdate])

  async function handleDeleteAccount() {
    if (!profile) return

    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone.'
    )
    if (!confirmed) return

    const doubleConfirmed = window.confirm(
      'This will permanently delete all your data, including events, tasks, bookings, and API keys. Continue?'
    )
    if (!doubleConfirmed) return

    try {
      const res = await fetch('/api/auth/delete-account', { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Failed to delete account. Contact support.')
        return
      }

      await supabase.auth.signOut()
      window.location.href = '/login'
    } catch {
      toast.error('Failed to delete account')
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal -- full-screen on mobile, centered card on desktop */}
      <div className="relative flex flex-col md:flex-row h-full md:h-[85vh] w-full md:max-w-3xl overflow-hidden md:rounded-xl border-0 md:border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Mobile: top nav with back-button pattern */}
        <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
          {!mobileNavOpen && (
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Settings
            </button>
          )}
          {mobileNavOpen && (
            <h2 className="flex-1 text-sm font-semibold text-[var(--fg)]">Settings</h2>
          )}
          <button
            onClick={() => onOpenChange(false)}
            className="ml-auto rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mobile: nav list or content, never both */}
        {mobileNavOpen && (
          <div className="flex md:hidden flex-1 flex-col overflow-y-auto bg-[var(--bg)] p-3">
            <nav className="flex flex-col gap-3">
              {SETTINGS_SECTIONS.map((section) => (
                <div key={section.label}>
                  <div className="px-3 py-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                    {section.label}
                  </div>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {section.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => {
                          setActiveTab(item.key)
                          setMobileNavOpen(false)
                        }}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                          activeTab === item.key
                            ? 'bg-[var(--surface)] text-[var(--fg)] font-medium'
                            : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]'
                        }`}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        )}

        {/* Desktop: left sidebar nav */}
        <div className="hidden md:flex w-52 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)] p-3 overflow-y-auto">
          <h2 className="mb-3 px-3 text-sm font-semibold text-[var(--fg)]">
            Settings
          </h2>
          <nav className="flex flex-col gap-3">
            {SETTINGS_SECTIONS.map((section) => (
              <div key={section.label}>
                <div className="px-3 py-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                  {section.label}
                </div>
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {section.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setActiveTab(item.key)}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        activeTab === item.key
                          ? 'bg-[var(--surface)] text-[var(--fg)] font-medium'
                          : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]'
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Right content -- shown on desktop always, on mobile only when nav is closed */}
        <div className={cn('flex-1 flex-col overflow-hidden', mobileNavOpen ? 'hidden md:flex' : 'flex')}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 md:px-6 py-3">
            <h3 className="text-sm font-semibold text-[var(--fg)]">
              {findTabLabel(activeTab)}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={saveSettings}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <button
                onClick={() => onOpenChange(false)}
                className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="space-y-8">
              {activeTab === 'shortcuts' && <ShortcutsTab />}
              {activeTab === 'calendars' && (
                <CalendarsTab
                  googleAccounts={googleAccounts}
                  calendars={calendars}
                  onConnect={handleConnectCalendar}
                  onDisconnect={handleDisconnectAccount}
                  onToggleCalendar={handleToggleCalendar}
                  onResync={handleResyncAccount}
                  onCreateLocal={(name) =>
                    changeLocalCalendar('/api/calendars', 'POST', { name }, 'Failed to create calendar')
                  }
                  onRenameLocal={(id, name) =>
                    changeLocalCalendar(`/api/calendars/${id}`, 'PATCH', { name })
                  }
                  taskSyncCalendarId={settings.task_sync_calendar_id ?? null}
                  onTaskSyncChange={async (calendarId) => {
                    updateSettings({ task_sync_calendar_id: calendarId })
                    const res = await fetch('/api/tasks/google-sync', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ calendar_id: calendarId }),
                    })
                    if (!res.ok) toast.error('Failed to change where tasks go')
                  }}
                  onDeleteLocal={(id) =>
                    changeLocalCalendar(`/api/calendars/${id}`, 'DELETE', undefined, 'Failed to delete calendar')
                  }
                />
              )}
              {activeTab === 'video' && <VideoConferencingTab />}
              {activeTab === 'telegram' && (
                <TelegramTab settings={settings} onChange={updateSettings} />
              )}
              {activeTab === 'general' && (
                <GeneralTab settings={settings} onChange={updateSettings} />
              )}
              {activeTab === 'notifications' && (
                <NotificationsTab
                  settings={settings}
                  onChange={updateSettings}
                  onNotificationChange={updateNotifications}
                />
              )}
              {activeTab === 'tags' && <TagsTab />}
              {activeTab === 'availability' && <AvailabilityTab />}
              {activeTab === 'booking' && <BookingPagesTab />}
              {activeTab === 'profile' && (
                <AccountTab
                  profile={profile}
                  displayName={displayName}
                  username={username}
                  company={company}
                  onDisplayNameChange={setDisplayName}
                  onUsernameChange={setUsername}
                  onCompanyChange={setCompany}
                  onDeleteAccount={handleDeleteAccount}
                />
              )}
              {activeTab === 'api-keys' && (
                <ApiKeyManager
                  apiKeys={apiKeys}
                  onKeysChange={setApiKeys}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
