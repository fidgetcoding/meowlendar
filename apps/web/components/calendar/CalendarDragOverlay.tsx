'use client'

import { DragOverlay } from '@dnd-kit/core'
import type { Active } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import type { CalendarItemData } from './calendar-types'
import { formatRange } from './time-format'

interface CalendarDragOverlayProps {
  active: Active | null
}

/** The item being dragged, drawn like its grid card (event tint, task card, striped routine). */
function OverlayContent({ item }: { item: CalendarItemData }) {
  return (
    <div
      className={cn('meow-ev is-overlay', `is-${item.type}`)}
      style={{ '--c': item.color } as React.CSSProperties}
    >
      <div className="meow-ev-t">
        {item.type === 'task' && <span className="meow-ev-box" />}
        {item.type === 'routine' && <span className="meow-ev-dot" />}
        <span className={cn(item.task?.status === 'done' && 'line-through')}>{item.title}</span>
      </div>
      <div className="meow-ev-tm">{formatRange(item.startTime, item.endTime)}</div>
    </div>
  )
}

export function CalendarDragOverlay({ active }: CalendarDragOverlayProps) {
  const item = active?.data?.current?.item as CalendarItemData | undefined

  return (
    <DragOverlay dropAnimation={null}>
      {item ? (
        <div
          style={{
            opacity: 0.92,
            cursor: 'grabbing',
            pointerEvents: 'none',
          }}
        >
          <OverlayContent item={item} />
        </div>
      ) : null}
    </DragOverlay>
  )
}
