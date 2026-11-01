export interface GoogleAccount {
  id: string
  user_id: string
  email: string
  token_expires_at: string
  sync_token: string | null
  last_synced_at: string | null
  created_at: string
}

export interface Calendar {
  id: string
  user_id: string
  /** Null on a local calendar. */
  google_account_id: string | null
  /** Null on a local calendar. */
  google_calendar_id: string | null
  source: 'google' | 'local'
  name: string
  color: string
  is_primary: boolean
  is_active: boolean
  access_role: 'owner' | 'writer' | 'reader' | null
  created_at: string
  updated_at: string
}
