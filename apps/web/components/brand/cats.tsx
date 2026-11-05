import * as React from 'react'
import type { TaskImportance } from '@poolendar/types'

// The cats, ported from the approved design (r4 app.js): flat SVG, soft solid coats,
// never emoji, never black.

function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16))
  const A = rgb(a)
  const B = rgb(b)
  return '#' + A.map((v, i) => Math.round(v + (B[i]! - v) * t).toString(16).padStart(2, '0')).join('')
}

/** The loaf: an orange tabby asleep, facing left. Sits on the now line and in the board's corner. */
export function Loaf({ className }: { className?: string }) {
  const b = '#e88a2c'
  const d = '#b55c16'
  const l = '#f9c27e'
  const e = '#3a2412'
  return (
    <svg className={className} viewBox="0 0 120 66" aria-hidden="true" focusable="false" style={{ overflow: 'visible' }}>
      <g className="meow-loaf-body">
        <path d="M10 64C6 44 22 24 50 20c28-3 56 6 62 28 2 9-2 16-8 16z" fill={b} />
      </g>
      <ellipse cx="26" cy="46" rx="19.5" ry="16.5" fill={b} />
      <path d="M10 39.5 7.4 21.5 22 31.6z" fill={b} />
      <path d="M25.6 30.2l9.4-14.2 5.6 17.6z" fill={b} />
      <path d="M11.8 35.4l-1.2-8 6 4.4z" fill={l} opacity=".8" />
      <path d="M60 22c-5 8-4 16 0 22M75 21c-3 8-2 16 2 23M90 26c-2 7-1 13 3 19" stroke={d} strokeWidth="4.2" strokeLinecap="round" fill="none" opacity=".5" />
      <path d="M22 31.5v5M27 31v5.5M32 32.5v4.5" stroke={d} strokeWidth="2.2" strokeLinecap="round" opacity=".5" />
      <ellipse cx="15.5" cy="53" rx="9" ry="6.6" fill={l} />
      <ellipse cx="38" cy="61.4" rx="9" ry="4.2" fill={l} />
      <path d="M107 61c-16 6-56 6-76 2" stroke={d} strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M33 63.4c-4 .4-7 .1-9-.8" stroke={l} strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M15.4 46.6q4.2 3 8.4 0" stroke={e} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M8.2 52.2h-5M8.6 55.2l-4.6 1.4" stroke={e} strokeWidth=".9" strokeLinecap="round" opacity=".5" />
      <path d="M7.4 49.6l2.6-.4-.9 2.2z" fill="#e07a6e" />
    </svg>
  )
}

/** A cat sitting on a frame: head and paws over the top edge, in a priority coat. */
export function SitCat({ coat, stripes = false, className }: { coat: string; stripes?: boolean; className?: string }) {
  const l = mix(coat, '#ffffff', 0.42)
  const d = mix(coat, '#000000', 0.2)
  const e = mix(coat, '#1a0f05', 0.78)
  return (
    <svg className={className} viewBox="0 0 32 22" aria-hidden="true" focusable="false" style={{ overflow: 'visible' }}>
      <path d="M5.6 7.6 5 1.4l6.2 3.6Q16 3.4 20.8 5l6.2-3.6-.6 6.2q2.6 3 1.8 9.4H3.8Q3 10.6 5.6 7.6z" fill={coat} />
      <path d="M7 6.2 6.8 3.4l2.6 1.7zM25 6.2l.2-2.8-2.6 1.7z" fill={l} />
      {stripes && (
        <path d="M14.6 5.4l.4 2.4M16 5v2.8M17.4 5.4 17 7.8" stroke={d} strokeWidth="1.1" strokeLinecap="round" opacity=".75" />
      )}
      <path d="M10.4 11.4q1.8 1.5 3.6 0M18 11.4q1.8 1.5 3.6 0" stroke={e} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M15.1 13.2h1.8l-.9 1z" fill="#e07a6e" />
      <ellipse cx="10.6" cy="17.6" rx="3.6" ry="2.6" fill={l} />
      <ellipse cx="21.4" cy="17.6" rx="3.6" ry="2.6" fill={l} />
      <path d="M9.6 18.6v1.2M11.6 18.6v1.2M20.4 18.6v1.2M22.4 18.6v1.2" stroke={d} strokeWidth=".8" strokeLinecap="round" opacity=".6" />
    </svg>
  )
}

/**
 * Priority cats: highest deep ginger, high orange, normal (Medium) beige, low grey, lowest none.
 * Done tasks keep theirs.
 */
export const PRIORITY_COATS: Record<TaskImportance, string | null> = {
  highest: '#c8611c',
  high: '#e88a2c',
  normal: '#d6b48a',
  low: '#a3a1ad',
  lowest: null,
}

export function PriorityCat({ importance, className }: { importance: TaskImportance; className?: string }) {
  const coat = PRIORITY_COATS[importance]
  if (!coat) return null
  return <SitCat coat={coat} stripes={importance === 'highest' || importance === 'high'} className={className} />
}

export function PawIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <path d="M8 7.6c2.5 0 4.4 2 4.4 4 0 1.5-1.2 2.4-2.5 2.4-.8 0-1.2-.4-1.9-.4s-1.1.4-1.9.4c-1.3 0-2.5-.9-2.5-2.4 0-2 1.9-4 4.4-4z" />
        <ellipse cx="3" cy="7" rx="1.5" ry="1.8" />
        <ellipse cx="6" cy="3.9" rx="1.5" ry="1.9" />
        <ellipse cx="10" cy="3.9" rx="1.5" ry="1.9" />
        <ellipse cx="13" cy="7" rx="1.5" ry="1.8" />
      </g>
    </svg>
  )
}

/** Done: a green paw in a rounded square. */
export function DonePaw({ className }: { className?: string }) {
  return (
    <span className={className ? `meow-done ${className}` : 'meow-done'} title="Done">
      <PawIcon />
    </span>
  )
}

/** "By your agent": a paw print, the words, a small orange cat. */
export function AgentLabel({ className }: { className?: string }) {
  return (
    <span className={className ? `meow-agent ${className}` : 'meow-agent'}>
      <PawIcon className="meow-agent-paw" />
      <span>By your agent</span>
      <SitCat coat="#e88a2c" stripes className="meow-agent-cat" />
    </span>
  )
}
