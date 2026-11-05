'use client'

import { useDroppable } from '@dnd-kit/core'
import type { TaskStatus } from '@poolendar/types'
import { cn } from '@/lib/utils'

interface EmptyColumnProps {
  status: TaskStatus
}

export function EmptyColumn({ status }: EmptyColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}-empty`,
    data: { type: 'column', status },
  })

  return (
    <div ref={setNodeRef} className={cn('meow-empty', isOver && 'is-over')}>
      No tasks
    </div>
  )
}
