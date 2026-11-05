'use client'

import { useEffect, useState } from 'react'

/** The demo account local setup creates (scripts/demo-account.mjs). Public by design. */
export const DEMO_EMAIL = 'demo@meowlendar.com'
export const DEMO_PASSWORD = 'meowlendar'

/** Whether this install has the demo account; false until known, and on any error. */
export function useDemoAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let live = true
    fetch('/api/demo-available')
      .then((res) => (res.ok ? res.json() : { available: false }))
      .then((body: { available?: unknown }) => {
        if (live) setAvailable(body.available === true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return available
}
