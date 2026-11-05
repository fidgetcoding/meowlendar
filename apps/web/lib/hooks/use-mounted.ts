'use client'

import { useSyncExternalStore } from 'react'

const noSubscription = () => () => {}

/**
 * False on the server and while hydrating, true from the browser's first render after that.
 *
 * Anything that depends on today's date (the week shown, the today column, "This week", the now
 * line) waits for this: the server's date can be a day off the viewer's (a server past midnight
 * in UTC, a browser in New York), and drawing it there fails hydration (React #418).
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false)
}
