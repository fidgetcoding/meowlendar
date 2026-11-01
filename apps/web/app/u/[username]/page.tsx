'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface HostPage {
  host: { display_name: string | null }
  links: { slug: string; name: string; duration_minutes: number }[]
}

// Landing page for a host's booking subdomain: `you.example.com/` lists their
// public booking links.
export default function BookingHostPage() {
  const { username } = useParams<{ username: string }>()
  const [page, setPage] = useState<HostPage | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/booking/host/${encodeURIComponent(username)}`)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setMissing(true)
          return
        }
        setPage((await res.json()) as HostPage)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [username])

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-16">
      {missing && <h1 className="text-xl font-semibold text-[var(--fg)]">Page not found</h1>}
      {page && (
        <>
          <h1 className="text-2xl font-semibold text-[var(--fg)]">
            Book time with {page.host.display_name || username}
          </h1>
          {page.links.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No booking pages are available right now.</p>
          )}
          <ul className="flex flex-col gap-2">
            {page.links.map((link) => (
              <li key={link.slug}>
                <a
                  href={`/book/${encodeURIComponent(link.slug)}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  {link.name}
                  <span className="text-xs text-[var(--muted)]">{link.duration_minutes} min</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
