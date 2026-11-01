'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { safeInternalPath } from '@/lib/safe-path'
import type { NotificationPayload } from './types'

// ---------------------------------------------------------------------------
// useNotifications — subscribe to Supabase Realtime in-app notifications
// ---------------------------------------------------------------------------

export function useNotifications(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return

    const supabase = createClient()

    const channel = supabase.channel(`notifications:${userId}`, {
      config: { private: true },
    })

    channel
      .on('broadcast', { event: 'notification' }, ({ payload }) => {
        const notification = payload as NotificationPayload
        const url = safeInternalPath(notification.url)

        toast(notification.title, {
          description: notification.body,
          action: url
            ? {
                label: 'Open',
                onClick: () => {
                  window.location.href = url
                },
              }
            : undefined,
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])
}
