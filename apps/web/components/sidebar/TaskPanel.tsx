'use client'

import * as React from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { useDraggable } from '@dnd-kit/core'
import {
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  Repeat2,
  SquareCheck,
  PanelRightClose,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTasks } from '@/lib/hooks/use-tasks'
import { useUndoable } from '@/lib/hooks/use-undoable'
import { useUIStore } from '@/lib/stores/ui-store'
import {
  groupTasks,
  countGrouped,
  filterTasks,
  isViewFilterActive,
  toDueDay,
  EMPTY_VIEW_FILTER,
  type TaskViewFilter,
} from '@/lib/tasks/grouping'
import { isAgentTask } from '@/lib/tasks/agent'
import { PanelViewToggle } from '@/components/PanelViewToggle'
import { AgentLabel, DonePaw } from '@/components/brand/cats'
import { ViewFilterMenu } from './TaskViewFilterMenu'
import { RoutinesPanel } from './RoutinesPanel'
import { UpNextCard } from './UpNext'
import type { Task } from '@poolendar/types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskPanelProps {
  /** Optional override — when omitted the panel fetches its own data via useTasks() */
  tasks?: Task[]
  onTaskClick?: (taskId: string) => void
  onTaskComplete?: (taskId: string) => void
  /** Desktop: closes the panel (the ribbon's Calendar button opens it again). */
  onHide?: () => void
  /** Rendered at the foot of the scrolling list (the calendar toggles). */
  children?: React.ReactNode
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
  tone?: 'overdue'
}

function Section({ title, count, children, defaultOpen = true, tone }: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  if (count === 0) return null

  return (
    <div className="meow-tl-sec">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn('meow-tl-sech', tone === 'overdue' && 'is-overdue')}
      >
        {open ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
        <span className="truncate">{title}</span>
        <span className="tabular-nums">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: Task
  onTaskClick: (id: string) => void
  onTaskComplete: (id: string) => void
}

function formatEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function dueLabel(task: Task, today: Date): { text: string; tone: 'overdue' | 'today' | null } | null {
  if (!task.due_date) return null
  const day = toDueDay(task.due_date)
  if (day < today) return { text: 'Overdue', tone: 'overdue' }
  if (isSameDay(day, today)) return { text: 'Today', tone: 'today' }
  return { text: format(day, 'MMM d'), tone: null }
}

function TaskRow({ task, onTaskClick, onTaskComplete }: TaskRowProps) {
  const isDone = task.status === 'done'
  const subtasks = task.subtasks ?? []
  const completedSubtasks = subtasks.filter((s) => s.completed).length
  const tags = task.tags ?? []
  const due = dueLabel(task, new Date(new Date().setHours(0, 0, 0, 0)))

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sidebar-task-${task.id}`,
    data: { type: 'sidebar-task', task },
  })

  const dragStyle: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 1000 }
    : (undefined as unknown as React.CSSProperties)

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      className={cn('meow-tl-row group cursor-grab', isDragging && 'opacity-50')}
      onClick={() => onTaskClick(task.id)}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onTaskClick(task.id)
        }
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTaskComplete(task.id)
        }}
        className="meow-ck"
        aria-label={isDone ? 'Reopen task' : 'Complete task'}
      >
        {isDone && <DonePaw />}
      </button>

      <div className="min-w-0">
        <div className={cn('meow-tl-title', isDone && 'is-done')}>{task.title}</div>
        <div className="meow-tl-ms">
          {due && <span className={cn(due.tone === 'overdue' && 'is-od', due.tone === 'today' && 'is-td')}>{due.text}</span>}
          {task.scheduled_start && <span>{format(parseISO(task.scheduled_start), 'EEE h:mm a')}</span>}
          {task.time_estimate_minutes ? <span>{formatEstimate(task.time_estimate_minutes)}</span> : null}
          {subtasks.length > 0 && (
            <span className="tabular-nums">
              {completedSubtasks}/{subtasks.length} subtasks
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag.id} className="meow-tag" style={{ '--tc': tag.color } as React.CSSProperties}>
              {tag.prefix ? `${tag.prefix} ${tag.name}` : tag.name}
            </span>
          ))}
          {isAgentTask(task) && <AgentLabel />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode tabs (Tasks / Routines) + list/board toggle
// ---------------------------------------------------------------------------

function ModeTabs({ mode, onHide }: { mode: 'tasks' | 'routines'; onHide?: () => void }) {
  const setMode = useUIStore((s) => s.setTaskPanelMode)
  return (
    <div className="meow-tp-top">
      <div className="meow-seg" role="group" aria-label="Task panel mode">
        <button type="button" onClick={() => setMode('tasks')} className={cn(mode === 'tasks' && 'is-on')}>
          <SquareCheck size={13} />
          Tasks
        </button>
        <button type="button" onClick={() => setMode('routines')} className={cn(mode === 'routines' && 'is-on')}>
          <Repeat2 size={13} />
          Routines
        </button>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <PanelViewToggle />
        {onHide && (
          <button type="button" onClick={onHide} className="meow-icon-btn" aria-label="Hide task panel" title="Hide task panel (Alt+A)">
            <PanelRightClose size={16} strokeWidth={1.6} />
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskPanel
// ---------------------------------------------------------------------------

export function TaskPanel({
  tasks: tasksProp,
  onTaskClick: onTaskClickProp,
  onTaskComplete: onTaskCompleteProp,
  onHide,
  children,
}: TaskPanelProps) {
  const { data: fetchedTasks } = useTasks()
  const undoable = useUndoable()
  const uiStore = useUIStore()

  const [searchQuery, setSearchQuery] = React.useState('')
  const [filter, setFilter] = React.useState<TaskViewFilter>(EMPTY_VIEW_FILTER)

  const tasks = React.useMemo(
    () => tasksProp ?? fetchedTasks ?? [],
    [tasksProp, fetchedTasks]
  )

  const handleTaskClick = React.useCallback(
    (id: string) => {
      if (onTaskClickProp) onTaskClickProp(id)
      else uiStore.openEditForm(id, 'task')
    },
    [onTaskClickProp, uiStore]
  )

  const handleTaskComplete = React.useCallback(
    (id: string) => {
      if (onTaskCompleteProp) {
        onTaskCompleteProp(id)
        return
      }
      const task = tasks.find((t) => t.id === id)
      if (!task) return
      if (task.status === 'done') undoable.reopenTask(task)
      else undoable.completeTask(task)
    },
    [onTaskCompleteProp, tasks, undoable]
  )

  const handleCreateTask = React.useCallback(() => {
    const mode = uiStore.taskPanelMode
    uiStore.openEditForm(null, mode === 'routines' ? 'routine' : 'task')
  }, [uiStore])

  const taskPanelMode = uiStore.taskPanelMode

  if (taskPanelMode === 'routines') {
    return (
      <div className="meow-tp">
        <ModeTabs mode="routines" onHide={onHide} />
        <div className="flex-1 min-h-0 overflow-hidden">
          <RoutinesPanel />
        </div>
        {children && <div className="meow-tp-foot">{children}</div>}
      </div>
    )
  }

  // Search filter, then the View filter (#36), then group (#30).
  const searched = searchQuery.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : tasks
  const visible = filterTasks(searched, filter)
  const groups = groupTasks(visible)
  const totalActive = countGrouped(groups)

  const rows = (list: Task[]) =>
    list.map((t) => <TaskRow key={t.id} task={t} onTaskClick={handleTaskClick} onTaskComplete={handleTaskComplete} />)

  return (
    <div className="meow-tp">
      <ModeTabs mode="tasks" onHide={onHide} />

      <label className="meow-tp-search">
        <Search size={16} strokeWidth={1.6} className="shrink-0" />
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </label>

      <UpNextCard />

      <div className="meow-tp-h">
        <h4>
          Open tasks
          {totalActive > 0 && <small className="tabular-nums">{totalActive}</small>}
        </h4>
        <ViewFilterMenu filter={filter} onChange={setFilter} />
      </div>

      <div className="meow-tl">
        <Section title="Overdue" count={groups.overdue.length} tone="overdue">
          {rows(groups.overdue)}
        </Section>
        <Section title="Due today" count={groups.dueToday.length}>
          {rows(groups.dueToday)}
        </Section>
        <Section title="Due tomorrow" count={groups.dueTomorrow.length}>
          {rows(groups.dueTomorrow)}
        </Section>
        <Section title="Due soon" count={groups.dueSoon.length} defaultOpen={false}>
          {rows(groups.dueSoon)}
        </Section>
        <Section title="Inbox" count={groups.inbox.length} defaultOpen={false}>
          {rows(groups.inbox)}
        </Section>

        {totalActive === 0 && (
          <p className="meow-tl-empty">
            {searchQuery.trim() || isViewFilterActive(filter) ? 'No matching tasks' : 'No tasks to show'}
          </p>
        )}

        {children && <div className="meow-tp-cals">{children}</div>}
      </div>

      <button type="button" onClick={handleCreateTask} className="meow-create">
        <Plus size={18} strokeWidth={1.8} />
        Create task
      </button>
    </div>
  )
}
