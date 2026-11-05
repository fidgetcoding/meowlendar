'use client'

import { cn } from '@/lib/utils'
import { useNow } from '@/lib/hooks/use-now'
import { formatTime, minutesOfDay } from './time-format'

interface TimeColumnProps {
  hourHeight: number
  startHour?: number
  endHour?: number
  /** Today is on screen: tag the now line's time in the gutter. */
  showNow?: boolean
}

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM'
  if (hour === 12) return '12 PM'
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

export function TimeColumn({
  hourHeight,
  startHour = 0,
  endHour = 24,
  showNow = false,
}: TimeColumnProps) {
  const now = useNow(showNow)
  const hours: number[] = []
  for (let h = startHour; h < endHour; h++) {
    hours.push(h)
  }

  const totalHeight = (endHour - startHour) * hourHeight
  const nowMinutes = now ? minutesOfDay(now) : null
  const nowInRange = now !== null && nowMinutes !== null && nowMinutes >= startHour * 60 && nowMinutes < endHour * 60

  return (
    <div className={cn('meow-gut relative shrink-0', 'select-none')} style={{ height: totalHeight }}>
      {hours.map((hour) => (
        <div
          key={hour}
          className="absolute right-0 pr-1.5 md:pr-[9px]"
          style={{
            top: (hour - startHour) * hourHeight,
            transform: 'translateY(-50%)',
          }}
        >
          {hour !== startHour && (
            <span className="meow-hl">{formatHourLabel(hour)}</span>
          )}
        </div>
      ))}
      {nowInRange && (
        <span className="meow-nowtag" style={{ top: (nowMinutes / 60 - startHour) * hourHeight }}>
          {formatTime(now, false).replace(/ [AP]M$/, '')}
        </span>
      )}
    </div>
  )
}
