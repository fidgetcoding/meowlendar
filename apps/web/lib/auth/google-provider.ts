'use client'

import { useEffect, useState } from 'react'

// Whether this install has Google sign-in turned on. Without it, "Continue with Google" lands the
// user on Supabase's raw JSON error ("Unsupported provider: provider is not enabled"), which every
// new self-hoster hits before they reach Setup step 7.
//
// Supabase Auth's public settings endpoint answers with { external: { google: boolean, ... } }.
// One request per page load, shared by every caller.

export type GoogleSignInState = 'unknown' | 'enabled' | 'disabled'

let check: Promise<GoogleSignInState> | null = null

async function fetchGoogleSignInState(): Promise<GoogleSignInState> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return 'unknown'
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key } })
    if (!res.ok) return 'unknown'
    const settings = (await res.json()) as { external?: { google?: unknown } }
    const google = settings.external?.google
    // Anything but a plain boolean means we can't tell, and the button keeps working as before.
    return google === true ? 'enabled' : google === false ? 'disabled' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The cached check. 'unknown' (settings unreachable) means: behave as if Google were set up. */
export function checkGoogleSignIn(): Promise<GoogleSignInState> {
  check ??= fetchGoogleSignInState()
  return check
}

/** For tests: forget the cached answer. */
export function resetGoogleSignInCheck(): void {
  check = null
}

export function useGoogleSignIn(): GoogleSignInState {
  const [state, setState] = useState<GoogleSignInState>('unknown')
  useEffect(() => {
    let live = true
    checkGoogleSignIn().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [])
  return state
}
