'use client'

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '@poolendar/types'
import { isToday, format } from 'date-fns'
import { cn } from '@/lib/utils'
import { toDueDay } from '@/lib/tasks/grouping'
import { DonePaw, PriorityCat } from '@/components/brand/cats'

interface TaskCardCompactProps {
  task: Task
  onTaskClick: (task: Task) => void
  onTaskComplete: (taskId: string) => void
}

/** One-line card for long columns (more than ten tasks). */
export const TaskCardCompact = React.memo(function TaskCardCompact({
  task,
  onTaskClick,
  onTaskComplete,
}: TaskCardCompactProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const isCompleted = task.status === 'done'
  const due = task.due_date ? toDueDay(task.due_date) : null
  const dueText = due ? (isToday(due) ? 'Today' : format(due, 'MMM d')) : null
  const dueTone = due && !isToday(due) && due < new Date() && !isCompleted ? 'is-od' : due && isToday(due) ? 'is-td' : undefined

  return (
    <div
      ref={setNodeRef}
      data-task-card
      data-task-id={task.id}
      style={style}
      className={cn('meow-card is-compact cursor-grab', isCompleted && 'is-done')}
      onClick={() => onTaskClick(task)}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        className="meow-ck"
        aria-label={isCompleted ? 'Reopen task' : 'Complete task'}
        onClick={(e) => {
          e.stopPropagation()
          onTaskComplete(task.id)
        }}
      >
        {isCompleted && <DonePaw />}
      </button>

      <span className="meow-compact-title">{task.title}</span>

      <span className="meow-compact-cat" aria-hidden="true">
        <PriorityCat importance={task.importance} />
      </span>

      {dueText && <span className={cn('meow-compact-due', dueTone)}>{dueText}</span>}
    </div>
  )
})
