'use client'

import { useState } from 'react'
import { Bell, Mail, Smartphone, MessageCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { SettingsSection, SettingsToggle } from './SettingsSection'
import { usePushSubscription } from '@/lib/notifications/use-push-subscription'
import { toast } from 'sonner'
import type { UserSettings, NotificationSettings } from '@poolendar/types'

interface NotificationsTabProps {
  settings: UserSettings
  onChange: (partial: Partial<UserSettings>) => void
  onNotificationChange: (
    channel: keyof NotificationSettings,
    key: string,
    value: boolean
  ) => void
}

const CHANNELS: {
  id: keyof NotificationSettings
  label: string
  icon: typeof Bell
  description: string
}[] = [
  {
    id: 'browser_push',
    label: 'Push Notifications',
    icon: Smartphone,
    description: 'Browser push notifications',
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    description: 'Email notifications',
  },
  {
    id: 'in_app',
    label: 'In-App',
    icon: Bell,
    description: 'In-app toast notifications',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: MessageCircle,
    description: 'Telegram bot messages',
  },
]

const EVENT_TYPES = [
  { key: 'reminders', label: 'Reminders' },
  { key: 'due_dates', label: 'Due dates' },
  { key: 'bookings', label: 'New bookings' },
  { key: 'schedule_changes', label: 'Schedule changes' },
]

export function NotificationsTab({
  settings,
  onChange,
  onNotificationChange,
}: NotificationsTabProps) {
  const push = usePushSubscription()
  const [testingChannel, setTestingChannel] = useState<string | null>(null)

  async function sendTestNotification(channel: string) {
    setTestingChannel(channel)
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || `Failed to send test ${channel} notification`)
        return
      }
      toast.success(`Test ${channel} notification sent`)
    } catch {
      toast.error(`Failed to send test ${channel} notification`)
    } finally {
      setTestingChannel(null)
    }
  }

  return (
    <>
      <SettingsSection
        title="Notification Channels"
        description="Configure how you receive notifications"
      >
        {CHANNELS.map((channel) => {
          const config = settings.notifications[channel.id]
          const isPush = channel.id === 'browser_push'

          return (
            <div
              key={channel.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <channel.icon className="h-4 w-4 text-[var(--muted)]" />
                  <div>
                    <div className="text-sm font-medium text-[var(--fg)]">
                      {channel.label}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {channel.description}
                    </div>
                  </div>
                </div>
                <SettingsToggle
                  checked={config.enabled}
                  onChange={(v) =>
                    onNotificationChange(channel.id, 'enabled', v)
                  }
                  label={`Enable ${channel.label}`}
                />
              </div>

              {/* Push subscription setup */}
              {isPush && config.enabled && (
                <div className="mb-3 ml-6 border-l border-[var(--border)] pl-4">
                  {!push.isSupported ? (
                    <p className="text-xs text-[var(--muted)]">
                      Push notifications are not supported in this browser.
                    </p>
                  ) : push.permissionState === 'denied' ? (
                    <p className="text-xs text-[var(--destructive)]">
                      Notifications are blocked. Enable them in your browser
                      settings for this site.
                    </p>
                  ) : push.isSubscribed ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-xs text-green-500">
                        Push notifications enabled
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 text-xs"
                        onClick={push.unsubscribe}
                        disabled={push.isLoading}
                      >
                        Disable
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={push.subscribe}
                      disabled={push.isLoading}
                    >
                      {push.isLoading && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Enable push notifications
                    </Button>
                  )}
                </div>
              )}

              {config.enabled && (
                <div className="ml-6 space-y-2 border-l border-[var(--border)] pl-4">
                  {EVENT_TYPES.map((type) => (
                    <div
                      key={type.key}
                      className="flex items-center justify-between"
                    >
                      <span className="text-xs text-[var(--muted)]">
                        {type.label}
                      </span>
                      <SettingsToggle
                        checked={
                          config[type.key as keyof typeof config] as boolean
                        }
                        onChange={(v) =>
                          onNotificationChange(channel.id, type.key, v)
                        }
                        label={`${type.label} via ${channel.label}`}
                      />
                    </div>
                  ))}

                  {/* Test notification button */}
                  <div className="pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-[var(--muted)]"
                      onClick={() => sendTestNotification(channel.id)}
                      disabled={testingChannel === channel.id}
                    >
                      {testingChannel === channel.id && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Send test notification
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </SettingsSection>

      <SettingsSection
        title="Telegram Integration"
        description="Connect a Telegram bot for notifications"
      >
        <p className="text-xs text-[var(--muted)]">
          Set the bot token under Integrations, Telegram.
        </p>
        <Input
          label="Chat ID"
          placeholder="Your Telegram chat ID"
          value={settings.telegram_chat_id || ''}
          onChange={(e) =>
            onChange({ telegram_chat_id: e.target.value || null })
          }
        />
      </SettingsSection>
    </>
  )
}
