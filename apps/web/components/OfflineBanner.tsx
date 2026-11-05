'use client'

import { useEffect, useRef, useState } from 'react'
import { useOnline } from '@/lib/offline/use-online'

/**
 * The strip above the calendar while changes can't reach the server: the browser is offline, or
 * it is online but the server isn't answering (`serverUnreachable`). Says so briefly once both
 * are back.
 */
export function OfflineBanner({ serverUnreachable = false }: { serverUnreachable?: boolean }) {
  const { isOnline, wasOffline } = useOnline()
  const [showReconnected, setShowReconnected] = useState(false)
  const [serverBack, setServerBack] = useState(false)
  const wasUnreachable = useRef(serverUnreachable)

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true)
      const timer = setTimeout(() => setShowReconnected(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isOnline, wasOffline])

  useEffect(() => {
    const was = wasUnreachable.current
    wasUnreachable.current = serverUnreachable
    if (was && !serverUnreachable) {
      setServerBack(true)
      const timer = setTimeout(() => setServerBack(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [serverUnreachable])

  if (!isOnline || serverUnreachable) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium shrink-0"
        style={{ backgroundColor: '#92400e', color: '#fef3c7' }}
      >
        <span className="w-2 h-2 rounded-full bg-yellow-300 animate-pulse" />
        {isOnline
          ? "Can't reach the server right now. Changes will sync when it's back."
          : 'You are offline. Changes will sync when reconnected.'}
      </div>
    )
  }

  if (showReconnected || serverBack) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium shrink-0 transition-opacity duration-1000"
        style={{ backgroundColor: '#065f46', color: '#d1fae5' }}
      >
        <span className="w-2 h-2 rounded-full bg-green-300" />
        Back online. Syncing...
      </div>
    )
  }

  return null
}
