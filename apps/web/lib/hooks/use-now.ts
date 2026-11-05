'use client'

import * as React from 'react'

const MINUTE_MS = 60_000

/**
 * The current time, refreshed on every minute boundary while `enabled`.
 *
 * Null on the server and on the first browser render: the server's clock and time zone never
 * match the viewer's, so anything drawn from "now" (the now line, its time tag, Up next) waits
 * for the browser instead of failing hydration.
 */
export function useNow(enabled = true): Date | null {
  const [now, setNow] = React.useState<Date | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => setNow(new Date())
    tick()
    const align = setTimeout(() => {
      tick()
      interval = setInterval(tick, MINUTE_MS)
    }, MINUTE_MS - (Date.now() % MINUTE_MS))
    return () => {
      clearTimeout(align)
      if (interval) clearInterval(interval)
    }
  }, [enabled])

  return enabled ? now : null
}
