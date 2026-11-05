'use client'

import type { TaskBoard } from '@poolendar/types'
import { cn } from '@/lib/utils'

interface BoardSwitcherProps {
  activeBoard: TaskBoard
  onBoardChange: (board: TaskBoard) => void
  currentCount: number
  futureCount: number
}

export function BoardSwitcher({
  activeBoard,
  onBoardChange,
  currentCount,
  futureCount,
}: BoardSwitcherProps) {
  const boards: { id: TaskBoard; label: string; count: number }[] = [
    { id: 'current', label: 'Current', count: currentCount },
    { id: 'future', label: 'Future', count: futureCount },
  ]
  return (
    <div className="meow-bseg" role="group" aria-label="Board">
      {boards.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onBoardChange(b.id)}
          aria-pressed={activeBoard === b.id}
          className={cn(activeBoard === b.id && 'is-on')}
        >
          {b.label}
          <span className="tabular-nums">{b.count}</span>
        </button>
      ))}
    </div>
  )
}
