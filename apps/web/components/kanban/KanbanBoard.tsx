'use client'

import * as React from 'react'
import { useState, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type {
  Task,
  TaskStatus,
  TaskBoard,
  TaskImportance,
  Tag,
} from '@poolendar/types'
import { KanbanColumn } from './KanbanColumn'
import { BoardSwitcher } from './BoardSwitcher'
import { KanbanFilters, type KanbanFilterState } from './KanbanFilters'
import { DragPreview } from './DragPreview'
import { PanelViewToggle } from '@/components/PanelViewToggle'

const COLUMN_ORDER: TaskStatus[] = ['backlog', 'in_progress', 'check', 'done']

interface KanbanBoardProps {
  /** Rendered between the board header and the columns (the undo strip). */
  belowHeader?: React.ReactNode
  tasks: Task[]
  tags: Tag[]
  onTaskMove: (
    taskId: string,
    newStatus: TaskStatus,
    newPosition: number
  ) => void
  onTaskReorder: (
    taskId: string,
    status: TaskStatus,
    newPosition: number
  ) => void
  onTaskCreate: (data: {
    title: string
    status: TaskStatus
    importance: TaskImportance
    due_date: string | null
    board: TaskBoard
  }) => void
  onTaskClick: (task: Task) => void
  onTaskComplete: (taskId: string) => void
}

// Resolve which column a task ID belongs to
function findColumnOfTask(
  columns: Record<TaskStatus, Task[]>,
  taskId: string
): TaskStatus | null {
  for (const status of COLUMN_ORDER) {
    if (columns[status].some((t) => t.id === taskId)) {
      return status
    }
  }
  return null
}

// Extract the status from a droppable ID like "column-backlog" or a task ID
function resolveDropStatus(
  columns: Record<TaskStatus, Task[]>,
  overId: string | number
): TaskStatus | null {
  const id = String(overId)

  // Direct column drop zones
  if (id.startsWith('column-')) {
    const statusPart = id.replace('column-', '').replace('-empty', '') as TaskStatus
    if (COLUMN_ORDER.includes(statusPart)) return statusPart
  }

  // Dropped over another task -> that task's column
  return findColumnOfTask(columns, id)
}

export function KanbanBoard({
  belowHeader,
  tasks,
  tags,
  onTaskMove,
  onTaskReorder,
  onTaskCreate,
  onTaskClick,
  onTaskComplete,
}: KanbanBoardProps) {
  const [activeBoard, setActiveBoard] = useState<TaskBoard>('current')
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null)
  const [filters, setFilters] = useState<KanbanFilterState>({
    tagIds: [],
    importanceLevels: [],
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 300, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Board-level counts (unfiltered, for the switcher badges)
  const currentCount = useMemo(
    () => tasks.filter((t) => t.board === 'current').length,
    [tasks]
  )
  const futureCount = useMemo(
    () => tasks.filter((t) => t.board === 'future').length,
    [tasks]
  )

  // Filter pipeline: board -> tags -> importance
  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => t.board === activeBoard)

    if (filters.tagIds.length > 0) {
      result = result.filter((t) =>
        t.tags?.some((tag) => filters.tagIds.includes(tag.id))
      )
    }

    if (filters.importanceLevels.length > 0) {
      result = result.filter((t) =>
        filters.importanceLevels.includes(t.importance)
      )
    }

    return result
  }, [tasks, activeBoard, filters])

  // Group tasks by status column, sorted by position
  const columns = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      in_progress: [],
      check: [],
      done: [],
    }

    for (const task of filteredTasks) {
      grouped[task.status].push(task)
    }

    // Sort each column by position (ascending)
    for (const status of COLUMN_ORDER) {
      grouped[status].sort((a, b) => {
        const posA = a.position ?? Infinity
        const posB = b.position ?? Infinity
        return posA - posB
      })
    }

    return grouped
  }, [filteredTasks])

  // Build parent title lookup for breadcrumb badges (O(n) via Map)
  const parentTitles = useMemo(() => {
    const map: Record<string, string> = {}
    const taskMap = new Map(tasks.map(t => [t.id, t]))
    for (const task of tasks) {
      if (task.parent_id) {
        const parent = taskMap.get(task.parent_id)
        if (parent) map[parent.id] = parent.title
      }
    }
    return map
  }, [tasks])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const taskData = active.data.current
      if (taskData?.type === 'task') {
        setActiveDragTask(taskData.task as Task)
      }
    },
    []
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveDragTask(null)

      if (!over) return

      const activeId = String(active.id)
      const overId = String(over.id)

      const sourceStatus = findColumnOfTask(columns, activeId)
      const destStatus = resolveDropStatus(columns, overId)

      if (!sourceStatus || !destStatus) return

      if (sourceStatus === destStatus) {
        // Reorder within same column
        const columnTasks = columns[sourceStatus]
        const oldIndex = columnTasks.findIndex((t) => t.id === activeId)
        const overTask = columnTasks.findIndex((t) => t.id === overId)

        if (oldIndex === -1) return
        // If dropped on the column droppable (not a task), do nothing
        if (overTask === -1 && overId.startsWith('column-')) return
        if (overTask === -1) return
        if (oldIndex === overTask) return

        const reordered = arrayMove(columnTasks, oldIndex, overTask)
        // Calculate fractional position between neighbors
        const newIndex = reordered.findIndex((t) => t.id === activeId)
        const newPosition = calculatePosition(reordered, newIndex)

        onTaskReorder(activeId, sourceStatus, newPosition)
      } else {
        // Move to different column
        const destTasks = columns[destStatus]

        // Figure out insertion index
        let insertIndex = destTasks.length // default: end
        const overTaskIndex = destTasks.findIndex((t) => t.id === overId)
        if (overTaskIndex !== -1) {
          insertIndex = overTaskIndex
        }

        const newPosition = calculateInsertPosition(
          destTasks,
          insertIndex
        )

        onTaskMove(activeId, destStatus, newPosition)
      }
    },
    [columns, onTaskMove, onTaskReorder]
  )

  function handleCreateTask(data: {
    title: string
    status: TaskStatus
    importance: TaskImportance
    due_date: string | null
  }) {
    onTaskCreate({
      ...data,
      board: activeBoard,
    })
  }

  return (
    <div className="flex flex-col h-full bg-[var(--surf)]">
      {/* Header: title, board switcher, filters */}
      <div className="meow-bhdr">
        <h2>Tasks</h2>
        <BoardSwitcher
          activeBoard={activeBoard}
          onBoardChange={setActiveBoard}
          currentCount={currentCount}
          futureCount={futureCount}
        />

        <div className="ml-auto flex items-center gap-2">
          <KanbanFilters
            tags={tags}
            filters={filters}
            onFiltersChange={setFilters}
          />
          <PanelViewToggle />
        </div>
      </div>

      {belowHeader}

      {/* Kanban columns */}
      <div className="flex-1 min-h-0">
        <DndContext
          id="kanban-dnd"
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="meow-cols">
            {COLUMN_ORDER.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={columns[status]}
                parentTitles={parentTitles}
                onTaskClick={onTaskClick}
                onTaskComplete={onTaskComplete}
                onCreateTask={handleCreateTask}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragTask ? (
              <DragPreview task={activeDragTask} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  )
}

/**
 * Calculate a fractional position for a task at a given index within
 * a sorted list. This produces stable ordering without renumbering
 * every task on each reorder.
 */
function calculatePosition(tasks: Task[], index: number): number {
  if (tasks.length === 0) return 1000
  if (tasks.length === 1) return tasks[0]!.position ?? 1000

  const prev = index > 0 ? tasks[index - 1] : null
  const next = index < tasks.length - 1 ? tasks[index + 1] : null

  const prevPos = prev?.position ?? 0
  const nextPos = next?.position ?? (prevPos + 2000)

  return (prevPos + nextPos) / 2
}

/**
 * Calculate a fractional position for inserting at a specific index
 * in a destination column.
 */
function calculateInsertPosition(
  destTasks: Task[],
  insertIndex: number
): number {
  if (destTasks.length === 0) return 1000

  if (insertIndex === 0) {
    const firstPos = destTasks[0]!.position ?? 1000
    return firstPos / 2
  }

  if (insertIndex >= destTasks.length) {
    const lastPos = destTasks[destTasks.length - 1]!.position ?? 1000
    return lastPos + 1000
  }

  const prevPos = destTasks[insertIndex - 1]!.position ?? 0
  const nextPos = destTasks[insertIndex]!.position ?? prevPos + 2000

  return (prevPos + nextPos) / 2
}
