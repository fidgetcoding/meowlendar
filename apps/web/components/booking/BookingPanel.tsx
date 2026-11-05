'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Copy, Check, Globe, Lock, X, Link2, ChevronDown, ChevronRight } from 'lucide-react'
import type { BookingLink } from '@poolendar/types'
import { useProfile } from '@/lib/hooks/use-profile'

// ---------------------------------------------------------------------------
// Booking panel (#51–52, #57a). A left-drawer list of the user's booking links
// with copy actions, plus a Pending Approvals queue where the host approves or
// declines requires_approval bookings.
// ---------------------------------------------------------------------------

interface PendingBooking {
  id: string
  booker_name: string
  booker_email: string
  start_time: string
  booking_links: { name: string; slug: string } | { name: string; slug: string }[]
}

function bookingUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${path}`
}

/** Copies a URL; the check mark shows for a moment after. */
function CopyButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied: leave the button as it was.
    }
  }
  return (
    <button type="button" onClick={copy} aria-label={label} title={label} className="meow-bp-copy">
      {copied ? <Check size={14} style={{ color: 'var(--success)' }} /> : <Copy size={14} />}
    </button>
  )
}

function linkName(b: PendingBooking): string {
  const l = Array.isArray(b.booking_links) ? b.booking_links[0] : b.booking_links
  return l?.name ?? 'Booking'
}

function whenLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function LinkRow({ link, booked }: { link: BookingLink; booked: number }) {
  return (
    <div className="meow-bp-link">
      <div className="min-w-0 flex-1">
        <div className="meow-bp-name">{link.name}</div>
        <div className="meow-bp-meta">
          <span>{link.duration_minutes} min</span>
          <span aria-hidden="true">·</span>
          <span>{booked} booked</span>
        </div>
      </div>
      <CopyButton url={bookingUrl(`/book/${link.slug}`)} label={`Copy link to ${link.name}`} />
    </div>
  )
}

function PendingApprovals() {
  const queryClient = useQueryClient()
  const { data: pending = [] } = useQuery({
    queryKey: ['booking-pending'],
    queryFn: async (): Promise<PendingBooking[]> => {
      const res = await fetch('/api/booking/bookings?status=pending')
      if (!res.ok) throw new Error(`Failed to load pending bookings (${res.status})`)
      const data = await res.json()
      return (Array.isArray(data) ? data : (data?.items ?? [])) as PendingBooking[]
    },
  })

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'approve' | 'decline' }) => {
      const res = await fetch(`/api/booking/bookings/${id}/${action}`, { method: 'POST' })
      if (!res.ok) throw new Error(`Failed to ${action} booking (${res.status})`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-pending'] })
    },
  })

  if (pending.length === 0) return null

  return (
    <div className="mb-2 border-b border-[var(--border)] pb-2">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
        Pending approvals ({pending.length})
      </div>
      {pending.map((b) => (
        <div key={b.id} className="px-3 py-2">
          <div className="text-sm text-[var(--fg)] truncate">{b.booker_name}</div>
          <div className="text-[11px] text-[var(--muted)]">
            {linkName(b)} · {whenLabel(b.start_time)}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => act.mutate({ id: b.id, action: 'approve' })}
              disabled={act.isPending}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[var(--bg)] disabled:opacity-50"
              style={{ backgroundColor: 'var(--success)' }}
              aria-label={`Approve booking from ${b.booker_name}`}
            >
              <Check size={11} /> Approve
            </button>
            <button
              type="button"
              onClick={() => act.mutate({ id: b.id, action: 'decline' })}
              disabled={act.isPending}
              className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--destructive)] disabled:opacity-50"
              aria-label={`Decline booking from ${b.booker_name}`}
            >
              <X size={11} /> Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Confirmed bookings per link, for the "N booked" line. */
function useBookedCounts(): Record<string, number> {
  const { data = [] } = useQuery({
    queryKey: ['booking-confirmed'],
    queryFn: async (): Promise<{ booking_link_id: string }[]> => {
      const res = await fetch('/api/booking/bookings?status=confirmed')
      if (!res.ok) throw new Error(`Failed to load bookings (${res.status})`)
      const data = await res.json()
      return (Array.isArray(data) ? data : (data?.items ?? [])) as { booking_link_id: string }[]
    },
  })
  return React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const b of data) counts[b.booking_link_id] = (counts[b.booking_link_id] ?? 0) + 1
    return counts
  }, [data])
}

/**
 * The booking panel, beside the ribbon (like Morgen): your booking page link, then public links
 * and the private ones folded away, plus the approvals waiting on you.
 */
export function BookingPanel({ onNewLink }: { onNewLink: () => void }) {
  const { data: links = [], isLoading, isError } = useQuery({
    queryKey: ['booking-links'],
    queryFn: async (): Promise<BookingLink[]> => {
      const res = await fetch('/api/booking-links')
      if (!res.ok) throw new Error(`Failed to load booking links (${res.status})`)
      const data = await res.json()
      return (Array.isArray(data) ? data : (data?.items ?? [])) as BookingLink[]
    },
  })
  const { data: profile } = useProfile()
  const booked = useBookedCounts()
  const [privateOpen, setPrivateOpen] = React.useState(false)

  const publicLinks = links.filter((l) => l.is_public)
  const privateLinks = links.filter((l) => !l.is_public)
  const pageUrl = profile?.username ? bookingUrl(`/u/${profile.username}`) : null

  return (
    <div className="meow-bp">
      <div className="meow-bp-head">
        <h3>Booking page</h3>
        <button type="button" onClick={onNewLink} aria-label="New booking link" title="New booking link" className="meow-bp-add">
          <Plus size={18} strokeWidth={1.6} />
        </button>
      </div>

      {pageUrl && (
        <div className="meow-bp-page">
          <Link2 size={15} strokeWidth={1.6} aria-hidden="true" />
          <a href={pageUrl} target="_blank" rel="noreferrer">Link to your booking page</a>
          <CopyButton url={pageUrl} label="Copy link to your booking page" />
        </div>
      )}

      <div className="meow-bp-body">
        <PendingApprovals />

        {isLoading && <p className="meow-bp-note">Loading...</p>}
        {isError && <p className="meow-bp-note">Couldn&apos;t load booking links.</p>}

        {!isLoading && !isError && links.length === 0 && (
          <div className="meow-bp-note">
            No booking links yet.
            <button type="button" onClick={onNewLink} className="meow-bp-first">
              Create your first link
            </button>
          </div>
        )}

        {publicLinks.length > 0 && (
          <section aria-label="Public links">
            <h4 className="meow-bp-h">
              <Globe size={13} aria-hidden="true" /> Public links
            </h4>
            {publicLinks.map((l) => <LinkRow key={l.id} link={l} booked={booked[l.id] ?? 0} />)}
          </section>
        )}

        {privateLinks.length > 0 && (
          <section aria-label="Private links">
            <button type="button" className="meow-bp-h is-toggle" aria-expanded={privateOpen} onClick={() => setPrivateOpen(!privateOpen)}>
              {privateOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Lock size={13} aria-hidden="true" /> Private links ({privateLinks.length})
            </button>
            {privateOpen && privateLinks.map((l) => <LinkRow key={l.id} link={l} booked={booked[l.id] ?? 0} />)}
          </section>
        )}
      </div>
    </div>
  )
}
