import * as React from 'react'
import { CURL_TAIL, CURL_TAIL_BOX, HEAD, LETTERS, RING, RING_BOX, WORDMARK_WIDTH } from './brand-paths'

// Ported from the approved design kit (r4 kit/brand.js) with the locked settings baked in:
// the cat curled into the o with the curl tail, no tail on the final r.

const TOP = -752
const BOTTOM = 20
const round = (v: number) => Math.round(v * 10) / 10

const WORDMARK_BOX = (() => {
  const x0 = Math.min(0, CURL_TAIL_BOX[0]) - 14
  const x1 = Math.max(WORDMARK_WIDTH, CURL_TAIL_BOX[2]) + 14
  return [round(x0), TOP, round(x1 - x0), BOTTOM - TOP]
})()

const MARK_BOX = (() => {
  const pad = 10
  const x0 = Math.min(RING_BOX[0], CURL_TAIL_BOX[0])
  const y0 = Math.min(RING_BOX[1], CURL_TAIL_BOX[1])
  const x1 = Math.max(RING_BOX[2], CURL_TAIL_BOX[2])
  const y1 = Math.max(RING_BOX[3], CURL_TAIL_BOX[3])
  return [round(x0 - pad), round(y0 - pad), round(x1 - x0 + 2 * pad), round(y1 - y0 + 2 * pad)]
})()

interface WordmarkProps {
  /** Height in px of the svg box; omit to size with CSS. */
  height?: number
  /** Letter colour (default currentColor). */
  color?: string
  /** Colour of the cat-o and its tail (default: the letter colour). */
  oColor?: string
  className?: string
  title?: string
  'aria-hidden'?: boolean
}

/** The lowercase serif `meowlendar` with the cat curled into the o. */
export function Wordmark({ height, color = 'currentColor', oColor, className, title = 'Meowlendar', ...rest }: WordmarkProps) {
  const [, , w, h] = WORDMARK_BOX
  const hidden = rest['aria-hidden']
  return (
    <svg
      className={className}
      viewBox={WORDMARK_BOX.join(' ')}
      height={height}
      width={height != null ? round((height * w!) / h!) : undefined}
      role={hidden ? undefined : 'img'}
      aria-label={hidden ? undefined : title}
      aria-hidden={hidden || undefined}
      focusable="false"
    >
      <path fill={color} d={LETTERS} />
      <g fill={oColor ?? color}>
        <path d={RING} />
        <path d={CURL_TAIL} />
      </g>
    </svg>
  )
}

interface CatMarkProps {
  height?: number
  color?: string
  className?: string
}

/** The cat-o on its own: sidebar logo, app icon, favicon. */
export function CatMark({ height, color = 'currentColor', className }: CatMarkProps) {
  const [, , w, h] = MARK_BOX
  return (
    <svg
      className={className}
      viewBox={MARK_BOX.join(' ')}
      height={height}
      width={height != null ? round((height * w!) / h!) : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <g fill={color}>
        <path d={RING} />
        <path d={CURL_TAIL} />
      </g>
    </svg>
  )
}

const NUMBER_INK = 0.7 // Fraunces lining figures: ink ~ .70em, centred .35em above the baseline

interface TodayHeadProps {
  num: number | string
  /** px font-size of the other day numbers; the number inside renders at exactly this size. */
  size?: number
  /** Head size multiplier (1 = the number fills ~35% of the head). */
  scale?: number
  color?: string
  inner?: string
  numColor?: string
  className?: string
}

/** The cat head behind today's date. The number is live text in the day-number font, not an outline. */
export function TodayHead({
  num,
  size = 24,
  scale = 0.88,
  color = 'var(--headc)',
  inner = 'var(--heade)',
  numColor = 'var(--headn)',
  className,
}: TodayHeadProps) {
  const fs = HEAD.dh / scale / NUMBER_INK
  const px = size / fs
  const baseline = round(HEAD.fy + (NUMBER_INK / 2) * fs)
  return (
    <svg
      className={className}
      viewBox={`0 0 100 ${HEAD.height}`}
      width={round(100 * px)}
      height={round(HEAD.height * px)}
      aria-hidden="true"
      focusable="false"
      style={{ overflow: 'visible' }}
    >
      <path fill={color} d={HEAD.d} />
      <path fill={inner} d="M15 13.1 16.9 28.8 28.1 20.6ZM85 13.1 83.1 28.8 71.9 20.6Z" />
      <text
        x={HEAD.fx}
        y={baseline}
        textAnchor="middle"
        fill={numColor}
        style={{
          fontFamily: 'var(--meow-num-font)',
          fontWeight: 'var(--meow-num-weight)',
          fontSize: `${Math.round(fs * 100) / 100}px`,
          fontVariantNumeric: 'lining-nums tabular-nums',
          letterSpacing: '-.02em',
        }}
      >
        {num}
      </text>
    </svg>
  )
}
