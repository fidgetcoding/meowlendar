'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/**
 * Keeps cached data in step with who is signed in: signing in refetches everything (anything
 * fetched a moment before held the signed-out answer, which is no rows), signing out drops it.
 */
export function AuthCacheSync() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') queryClient.invalidateQueries()
      else if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => subscription.unsubscribe()
  }, [queryClient])
  return null
}
