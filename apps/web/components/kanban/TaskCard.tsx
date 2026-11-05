'use client'

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Calendar,
  Clock,
  GripVertical,
  ChevronRight,
  ListChecks,
} from 'lucide-react'
import type { Task } from '@poolendar/types'
import { isToday, format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { toDueDay } from '@/lib/tasks/grouping'
import { isAgentTask } from '@/lib/tasks/agent'
import { AgentLabel, DonePaw, PriorityCat, PRIORITY_COATS } from '@/components/brand/cats'
import { IMPORTANCE_PILL } from './importance'

// Where the priority cat sits on the frame, picked from the task id so it stays put as cards move.
const CAT_SPOTS: React.CSSProperties[] = [
  { right: 18 }, { left: '44%' }, { right: 30 }, { left: '32%' },
  { right: 22 }, { left: '56%' }, { right: 40 }, { left: '38%' },
]

function catSpot(id: string): React.CSSProperties {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CAT_SPOTS[h % CAT_SPOTS.length]!
}

function formatTimeEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (remaining === 0) return `${hours}h`
  return `${hours}h ${remaining}m`
}

interface TaskCardProps {
  task: Task
  onTaskClick: (task: Task) => void
  onTaskComplete: (taskId: string) => void
  parentTitle?: string
  isDragOverlay?: boolean
}

export const TaskCard = React.memo(function TaskCard({
  task,
  onTaskClick,
  onTaskComplete,
  parentTitle,
  isDragOverlay = false,
}: TaskCardProps) {
  const sortable = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: isDragOverlay,
  })

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable

  const transformStyle = CSS.Transform.toString(transform)

  const isCompleted = task.status === 'done'
  const subtasks = task.subtasks ?? []
  const hasSubtasks = subtasks.length > 0
  const subtasksDone = subtasks.filter((s) => s.completed).length
  const subtasksTotal = subtasks.length
  const subtaskProgress =
    subtasksTotal > 0 ? (subtasksDone / subtasksTotal) * 100 : 0

  const tags = task.tags ?? []
  const isAgent = isAgentTask(task)
  const hasCat = PRIORITY_COATS[task.importance] !== null
  const pill = IMPORTANCE_PILL[task.importance]

  function getDueDateInfo(): { text: string; tone: 'over' | 'today' | null } | null {
    if (!task.due_date) return null
    const date = toDueDay(task.due_date)
    if (isToday(date)) return { text: 'Today', tone: 'today' }
    if (date < new Date() && !isCompleted) return { text: 'Overdue', tone: 'over' }
    return { text: format(date, 'MMM d'), tone: null }
  }

  const dueInfo = getDueDateInfo()

  const cardStyle: React.CSSProperties = {
    transform: transformStyle ?? undefined,
    transition: transition ?? undefined,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={cardStyle}
      data-task-card
      data-task-id={task.id}
      className={cn('meow-card group', isCompleted && 'is-done', isAgent && 'is-agent', hasCat && 'has-cat')}
      onClick={() => onTaskClick(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onTaskClick(task)
        }
      }}
    >
      {hasCat && (
        <div className="meow-sit" style={catSpot(task.id)} aria-hidden="true">
          <PriorityCat importance={task.importance} />
        </div>
      )}

      {!isDragOverlay && (
        <div className="meow-grip cursor-grab" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </div>
      )}

      {/* Title row: check square (green paw when done) + title */}
      <div className="meow-card-ttl">
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

        <div className="flex-1 min-w-0">
          <p>{task.title}</p>

          {/* Description preview (#40) — truncated to two lines */}
          {task.notes && <p className="meow-card-notes">{task.notes}</p>}
        </div>
      </div>

      {/* Parent breadcrumb */}
      {parentTitle && (
        <div className="meow-card-meta">
          <span className="meow-pill">
            <ChevronRight size={12} />
            <span className="truncate max-w-[160px]">{parentTitle}</span>
          </span>
        </div>
      )}

      {/* Importance, due date, estimate, schedule */}
      <div className="meow-card-meta">
        <span className={cn('meow-pill is-imp', `is-${task.importance}`)} style={{ '--ic': pill.color } as React.CSSProperties}>
          {pill.label}
        </span>

        {dueInfo && (
          <span className={cn('meow-pill', dueInfo.tone === 'over' && 'is-over', dueInfo.tone === 'today' && 'is-today')}>
            <Calendar size={12} />
            {dueInfo.text}
          </span>
        )}

        {task.time_estimate_minutes ? (
          <span className="meow-pill">
            <Clock size={12} />
            {formatTimeEstimate(task.time_estimate_minutes)}
          </span>
        ) : null}

        {task.scheduled_start && task.scheduled_end && (
          <span className="meow-pill">
            <ChevronRight size={12} />
            {format(parseISO(task.scheduled_start), 'EEE h:mm a')}
          </span>
        )}
      </div>

      {/* Subtask progress */}
      {hasSubtasks && (
        <div className="meow-subt">
          <ListChecks size={14} strokeWidth={1.6} />
          <span className="tabular-nums">
            {subtasksDone}/{subtasksTotal}
          </span>
          <span className="meow-subt-bar">
            <i style={{ width: `${subtaskProgress}%` }} />
          </span>
        </div>
      )}

      {/* Tags: dot + name */}
      {tags.length > 0 && (
        <div className="meow-card-meta">
          {tags.map((tag) => (
            <span key={tag.id} className="meow-tag" style={{ '--tc': tag.color } as React.CSSProperties}>
              {tag.prefix ? `${tag.prefix} ${tag.name}` : tag.name}
            </span>
          ))}
        </div>
      )}

      {isAgent && (
        <div>
          <AgentLabel />
        </div>
      )}
    </div>
  )
})
