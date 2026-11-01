'use client'

import * as React from 'react'
import Image from 'next/image'
import { User, Trash2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SettingsSection } from './SettingsSection'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@poolendar/types'

interface AccountTabProps {
  profile: Profile | null
  displayName: string
  username: string
  company: string
  onDisplayNameChange: (v: string) => void
  onUsernameChange: (v: string) => void
  onCompanyChange: (v: string) => void
  onDeleteAccount: () => void
}

export function AccountTab({
  profile,
  displayName,
  username,
  company,
  onDisplayNameChange,
  onUsernameChange,
  onCompanyChange,
  onDeleteAccount,
}: AccountTabProps) {
  const [email, setEmail] = React.useState<string | null>(null)

  React.useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <>
      <SettingsSection title="Profile">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface-hover)] text-2xl">
            {profile?.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <User className="h-8 w-8 text-[var(--muted)]" />
            )}
          </div>
          <div>
            <p className="text-sm text-[var(--fg)]">
              {profile?.display_name || 'No name set'}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Change your avatar via Google account settings
            </p>
          </div>
        </div>

        {email && (
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">
              Email
            </label>
            <p className="text-sm text-[var(--fg)] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 opacity-70">
              {email}
            </p>
          </div>
        )}

        <Input
          label="Display name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="Your name"
        />
        <Input
          label="Username"
          value={username}
          onChange={(e) =>
            onUsernameChange(
              e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
            )
          }
          placeholder="username"
        />
        <p className="text-xs text-[var(--muted)]">
          Your booking pages live at{' '}
          <span className="text-[var(--accent)]">
            {typeof window !== 'undefined' ? window.location.origin : ''}/book/your-link
          </span>
        </p>
        <Input
          label="Company"
          value={company}
          onChange={(e) => onCompanyChange(e.target.value)}
          placeholder="Your company (optional)"
        />
      </SettingsSection>

      <SettingsSection title="Session">
        <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
          <div>
            <p className="text-sm font-medium text-[var(--fg)]">Sign Out</p>
            <p className="text-xs text-[var(--muted)]">
              Sign out of your account on this device
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Danger Zone">
        <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--destructive)]">
                Delete Account
              </p>
              <p className="text-xs text-[var(--muted)]">
                Permanently delete your account and all associated data
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDeleteAccount}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </SettingsSection>
    </>
  )
}
