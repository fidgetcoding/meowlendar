'use client'

import { useEffect, useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { SettingsSection } from './SettingsSection'
import { toast } from 'sonner'
import type { UserSettings } from '@poolendar/types'

interface TelegramTabProps {
  settings: UserSettings
  onChange: (partial: Partial<UserSettings>) => void
}

export function TelegramTab({ settings, onChange }: TelegramTabProps) {
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tokenSet, setTokenSet] = useState(false)
  const [newToken, setNewToken] = useState('')

  const hasConfig = tokenSet && !!settings.telegram_chat_id

  useEffect(() => {
    let cancelled = false
    fetch('/api/telegram/token')
      .then((res) => (res.ok ? res.json() : { configured: false }))
      .then((body) => {
        if (!cancelled) setTokenSet(Boolean(body.configured))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function saveToken() {
    setSaving(true)
    try {
      const res = await fetch('/api/telegram/token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: newToken.trim() }),
      })
      if (!res.ok) {
        toast.error('That does not look like a bot token')
        return
      }
      setTokenSet(true)
      setNewToken('')
      toast.success('Bot token saved')
    } catch {
      toast.error('Failed to save the bot token')
    } finally {
      setSaving(false)
    }
  }

  async function removeToken() {
    setSaving(true)
    try {
      const res = await fetch('/api/telegram/token', { method: 'DELETE' })
      if (res.ok) {
        setTokenSet(false)
        toast.success('Bot token removed')
      } else {
        toast.error('Failed to remove the bot token')
      }
    } catch {
      toast.error('Failed to remove the bot token')
    } finally {
      setSaving(false)
    }
  }

  async function sendTestMessage() {
    setSending(true)
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'telegram' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || 'Failed to send test message')
        return
      }
      toast.success('Test message sent to Telegram')
    } catch {
      toast.error('Failed to send test message')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <SettingsSection
        title="Telegram Integration"
        description="Connect a Telegram bot to receive notifications directly in Telegram"
      >
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <Send className="h-4 w-4 text-[var(--muted)]" />
            <span className="text-sm font-medium text-[var(--fg)]">
              Setup Instructions
            </span>
          </div>
          <ol className="space-y-1.5 text-xs text-[var(--muted)] list-decimal list-inside">
            <li>
              Open Telegram and message{' '}
              <span className="text-[var(--accent)]">@BotFather</span>
            </li>
            <li>
              Send <code className="rounded bg-[var(--surface)] px-1">/newbot</code>{' '}
              and follow the prompts to create a bot
            </li>
            <li>Copy the bot token and paste it below</li>
            <li>
              Start a chat with your bot, then send{' '}
              <code className="rounded bg-[var(--surface)] px-1">/start</code>
            </li>
            <li>Enter your Chat ID below to receive notifications</li>
          </ol>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={tokenSet ? 'Bot Token (saved, enter a new one to replace it)' : 'Bot Token'}
              type="password"
              autoComplete="off"
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={saveToken} disabled={saving || !newToken.trim()}>
            Save
          </Button>
          {tokenSet && (
            <Button variant="outline" size="sm" onClick={removeToken} disabled={saving}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-[var(--muted)]">
          The token is encrypted on the server and never sent back to your browser.
        </p>
        <Input
          label="Chat ID"
          placeholder="Your Telegram chat ID"
          value={settings.telegram_chat_id || ''}
          onChange={(e) =>
            onChange({ telegram_chat_id: e.target.value || null })
          }
        />

        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={sendTestMessage}
            disabled={sending || !hasConfig}
          >
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Send className="h-3.5 w-3.5" />
            Send test message
          </Button>
          {!hasConfig && (
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              Enter both bot token and chat ID above to send a test message.
            </p>
          )}
        </div>
      </SettingsSection>
    </>
  )
}
