'use client'

import { useState } from 'react'
import { Key, Copy, Trash2, Plus, Check, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SettingsSection } from './SettingsSection'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { ApiKey } from '@poolendar/types'

interface ApiKeyManagerProps {
  apiKeys: ApiKey[]
  onKeysChange: (keys: ApiKey[]) => void
}

export function ApiKeyManager({ apiKeys, onKeysChange }: ApiKeyManagerProps) {
  const supabase = createClient()
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleCreateKey() {
    if (!newKeyName.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to create API key')
        return
      }

      const { key, ...apiKey } = await res.json()
      setNewlyCreatedKey(key)
      onKeysChange([...apiKeys, apiKey])
      setNewKeyName('')
    } catch {
      toast.error('Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteKey(id: string) {
    try {
      const res = await fetch(`/api/api-keys/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        toast.error('Failed to delete API key')
        return
      }

      onKeysChange(apiKeys.filter((k) => k.id !== id))
      setDeletingId(null)
      toast.success('API key deleted')
    } catch {
      toast.error('Failed to delete API key')
    }
  }

  function copyKey(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Copied to clipboard')
  }

  return (
    <SettingsSection
      title="API Keys"
      description="Manage API keys for programmatic access to Meowlendar"
    >
      {/* Existing keys */}
      <div className="space-y-2">
        {apiKeys.length === 0 && !newlyCreatedKey && (
          <p className="text-sm text-[var(--muted)]">
            No API keys created yet.
          </p>
        )}

        {apiKeys.map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <Key className="h-4 w-4 text-[var(--muted)]" />
              <div>
                <div className="text-sm font-medium text-[var(--fg)]">
                  {key.name}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {key.key_prefix}...
                  {key.last_used_at
                    ? ` | Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                    : ' | Never used'}
                  {' | Created '}
                  {new Date(key.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>

            {deletingId === key.id ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--destructive)]">
                  Delete this key?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDeleteKey(key.id)}
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeletingId(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setDeletingId(key.id)}
                className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--destructive)]"
                aria-label={`Delete ${key.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Newly created key (shown once) */}
      {newlyCreatedKey && (
        <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 p-3">
          <p className="mb-2 text-xs font-medium text-[var(--accent)]">
            Copy this key now. It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] font-mono">
              {newlyCreatedKey}
            </code>
            <button
              onClick={() => copyKey(newlyCreatedKey)}
              className="rounded p-2 text-[var(--accent)] transition-colors hover:bg-[var(--surface-hover)]"
              aria-label="Copy API key"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <button
            onClick={() => setNewlyCreatedKey(null)}
            className="mt-2 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            I have copied the key
          </button>
        </div>
      )}

      {/* Create new key */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Key name"
            placeholder='e.g., "Claude Code", "n8n"'
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
          />
        </div>
        <Button
          onClick={handleCreateKey}
          disabled={creating || !newKeyName.trim()}
          size="default"
        >
          <Plus className="h-4 w-4" />
          Generate
        </Button>
      </div>

      <a
        href="https://github.com/fidgetcoding/meowlendar/blob/main/packages/mcp/README.md"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
      >
        API documentation
        <ExternalLink className="h-3 w-3" />
      </a>
    </SettingsSection>
  )
}
