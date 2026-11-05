'use client'

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { Task, TaskStatus, TaskImportance } from '@poolendar/types'
import { TaskCard } from './TaskCard'
import { TaskCardCompact } from './TaskCardCompact'
import { EmptyColumn } from './EmptyColumn'
import { QuickAddTask } from './QuickAddTask'
import { Loaf } from '@/components/brand/cats'
import { cn } from '@/lib/utils'

const COLUMN_TITLES: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  check: 'Check',
  done: 'Done',
}

const COMPACT_THRESHOLD = 10

interface KanbanColumnProps {
  status: TaskStatus
  tasks: Task[]
  parentTitles: Record<string, string>
  onTaskClick: (task: Task) => void
  onTaskComplete: (taskId: string) => void
  onCreateTask: (data: {
    title: string
    status: TaskStatus
    importance: TaskImportance
    due_date: string | null
  }) => void
}

export function KanbanColumn({
  status,
  tasks,
  parentTitles,
  onTaskClick,
  onTaskComplete,
  onCreateTask,
}: KanbanColumnProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [headerAddOpen, setHeaderAddOpen] = useState(false)

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: 'column', status },
  })

  const useCompact = tasks.length > COMPACT_THRESHOLD
  const taskIds = tasks.map((t) => t.id)

  return (
    <div data-kanban-column={status} className={cn('meow-bcol', isOver && 'is-over')}>
      {/* Column header */}
      <div className="meow-bch">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          className="meow-bch-title group"
        >
          <span className="meow-bch-h">{COLUMN_TITLES[status]}</span>
          <span className="meow-bch-cnt">{tasks.length}</span>
          {isCollapsed ? (
            <ChevronRight size={14} className="text-[var(--muted)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>

        {/* Column-header add (#42) — creates a task pre-assigned to this column */}
        <button
          type="button"
          onClick={() => {
            setIsCollapsed(false)
            setHeaderAddOpen(true)
          }}
          aria-label={`Add task to ${COLUMN_TITLES[status]}`}
          title={`Add task to ${COLUMN_TITLES[status]}`}
          className="meow-bch-add"
        >
          <Plus size={18} strokeWidth={1.6} />
        </button>
      </div>

      {/* Collapse/expand content */}
      {!isCollapsed && (
        <div ref={setNodeRef} className="meow-blist">
          {headerAddOpen && (
            <div className="mb-1">
              <QuickAddTask
                status={status}
                onCreateTask={onCreateTask}
                startOpen
                onClose={() => setHeaderAddOpen(false)}
              />
            </div>
          )}

          <SortableContext
            items={taskIds}
            strategy={verticalListSortingStrategy}
          >
            {tasks.length === 0 ? (
              <EmptyColumn status={status} />
            ) : (
              <div className="meow-bcards">
                {tasks.map((task) =>
                  useCompact ? (
                    <TaskCardCompact
                      key={task.id}
                      task={task}
                      onTaskClick={onTaskClick}
                      onTaskComplete={onTaskComplete}
                    />
                  ) : (
                    <TaskCard
                      key={task.id}
                      task={task}
                      parentTitle={
                        task.parent_id
                          ? parentTitles[task.parent_id]
                          : undefined
                      }
                      onTaskClick={onTaskClick}
                      onTaskComplete={onTaskComplete}
                    />
                  )
                )}
              </div>
            )}
          </SortableContext>

          {/* Quick add at column bottom */}
          <div className="mt-1">
            <QuickAddTask status={status} onCreateTask={onCreateTask} />
          </div>
        </div>
      )}

      {/* The big corner loaf, asleep at the foot of Done */}
      {status === 'done' && (
        <div className="meow-donecat" aria-hidden="true">
          <Loaf />
        </div>
      )}
    </div>
  )
}
