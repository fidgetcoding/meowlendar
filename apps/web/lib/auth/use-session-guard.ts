'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { checkSession, sessionRetryDelayMs } from './session-check'

/**
 * Confirms the session when the app opens. Sends the user to sign in only when there is
 * definitely no session; while the auth server can't be reached it keeps them here, reports
 * `unreachable`, and checks again with backoff (straight away when the browser comes back online).
 */
export function useSessionGuard(onSignedIn: (user: User) => void): { unreachable: boolean } {
  const router = useRouter()
  const [unreachable, setUnreachable] = useState(false)
  // Read at the moment of use, so a new router or callback identity never restarts the check.
  const latest = useRef({ router, onSignedIn })
  useEffect(() => {
    latest.current = { router, onSignedIn }
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let waiting = false
    let attempt = 0

    async function check() {
      waiting = false
      const result = await checkSession(createClient().auth)
      if (cancelled) return
      if (result.kind === 'unreachable') {
        setUnreachable(true)
        waiting = true
        timer = setTimeout(check, sessionRetryDelayMs(attempt++))
        return
      }
      setUnreachable(false)
      if (result.kind === 'signed-in') latest.current.onSignedIn(result.user)
      else latest.current.router.push('/login')
    }

    function retryNow() {
      if (!waiting) return
      clearTimeout(timer)
      attempt = 0
      void check()
    }

    void check()
    window.addEventListener('online', retryNow)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('online', retryNow)
    }
  }, [])

  return { unreachable }
}
