'use client'

import * as React from 'react'
import { format, startOfDay, addDays } from 'date-fns'
import { useDraggable } from '@dnd-kit/core'
import {
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Repeat2,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useRoutines,
  useCompleteRoutineInstance,
  useResetRoutineInstance,
  useTodayRoutineInstances,
} from '@/lib/hooks/use-routines'
import { useUIStore } from '@/lib/stores/ui-store'
import type { Routine, RoutineInstance } from '@poolendar/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}

const DAY_NUMBERS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

function parseRecurrenceRule(rule: string): string {
  if (!rule) return 'No schedule'

  const freqMatch = rule.match(/FREQ=(\w+)/)
  const byDayMatch = rule.match(/BYDAY=([A-Z,]+)/)
  const intervalMatch = rule.match(/INTERVAL=(\d+)/)

  const freq = freqMatch?.[1]
  const interval = intervalMatch?.[1] ? parseInt(intervalMatch[1], 10) : 1

  if (freq === 'DAILY') {
    return interval > 1 ? `Every ${interval} days` : 'Daily'
  }

  if (freq === 'WEEKLY') {
    const prefix = interval > 1 ? `Every ${interval} weeks` : 'Weekly'
    if (byDayMatch?.[1]) {
      const days = byDayMatch[1].split(',')
      if (days.length === 5 && !days.includes('SA') && !days.includes('SU')) {
        return 'Every weekday'
      }
      if (days.length === 7) {
        return 'Daily'
      }
      const dayNames = days.map((d) => DAY_NAMES[d] || d).join(', ')
      return `${prefix} on ${dayNames}`
    }
    return prefix
  }

  if (freq === 'MONTHLY') {
    return interval > 1 ? `Every ${interval} months` : 'Monthly'
  }

  return rule
}

function routineOccursOnDay(routine: Routine, day: Date): boolean {
  const rule = routine.recurrence_rule
  if (!rule) return false

  if (rule.includes('FREQ=DAILY')) return true

  const byDayMatch = rule.match(/BYDAY=([A-Z,]+)/)
  if (byDayMatch?.[1]) {
    const allowedDays = byDayMatch[1]
      .split(',')
      .map((d) => DAY_NUMBERS[d])
      .filter((d): d is number => d !== undefined)
    return allowedDays.includes(day.getDay())
  }

  return true
}

function getNextOccurrence(routine: Routine): Date | null {
  const today = startOfDay(new Date())
  for (let i = 0; i <= 14; i++) {
    const day = addDays(today, i)
    if (routineOccursOnDay(routine, day)) {
      if (i === 0) continue // Skip today for "next" occurrence
      return day
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Collapsible section (matches TaskPanel style)
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string
  count: number
  icon?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  accentColor?: string
}

function Section({
  title,
  count,
  icon,
  children,
  defaultOpen = true,
  accentColor,
}: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  if (count === 0) return null

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-1.5 text-sm font-medium',
          'hover:bg-[var(--surface-hover)] rounded',
          'transition-colors duration-150'
        )}
        style={{ color: accentColor || 'var(--fg)' }}
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )}
        {icon}
        <span className="truncate">{title}</span>
        <span
          className="ml-auto text-xs tabular-nums"
          style={{ color: 'var(--muted)' }}
        >
          {count}
        </span>
      </button>
      {open && <div className="pl-1">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Draggable routine row
// ---------------------------------------------------------------------------

interface RoutineRowProps {
  routine: Routine
  instance?: RoutineInstance
  onComplete: (routineId: string, date: string) => void
  onUncomplete: (routineId: string, date: string) => void
  onClick: (routineId: string) => void
}

function RoutineRow({
  routine,
  instance,
  onComplete,
  onUncomplete,
  onClick,
}: RoutineRowProps) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const isCompleted = instance?.status === 'completed'
  const patternText = parseRecurrenceRule(routine.recurrence_rule)
  const nextOccurrence = getNextOccurrence(routine)

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `sidebar-routine-${routine.id}`,
      data: { type: 'sidebar-routine', routine },
    })

  const style: React.CSSProperties = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
        zIndex: 1000,
      }
    : undefined as unknown as React.CSSProperties

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm cursor-grab',
        'hover:bg-[var(--surface-hover)] rounded',
        'transition-colors duration-150 group',
        isDragging && 'opacity-50'
      )}
      onClick={() => onClick(routine.id)}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(routine.id)
        }
      }}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (isCompleted) {
            onUncomplete(routine.id, today)
          } else {
            onComplete(routine.id, today)
          }
        }}
        className={cn(
          'shrink-0 w-4 h-4 rounded border flex items-center justify-center',
          'transition-colors duration-150',
          'hover:border-[var(--accent)]'
        )}
        style={{ borderColor: isCompleted ? 'var(--accent)' : 'var(--border)' }}
        aria-label={isCompleted ? 'Uncheck routine' : 'Complete routine'}
      >
        {isCompleted && (
          <CheckSquare size={12} style={{ color: 'var(--accent)' }} />
        )}
      </button>

      {/* Repeat icon */}
      <Repeat2
        size={12}
        className="shrink-0"
        style={{ color: 'var(--muted)' }}
      />

      {/* Title + pattern */}
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            'block truncate',
            isCompleted && 'text-[var(--muted)] line-through'
          )}
          style={{ color: isCompleted ? undefined : 'var(--fg)' }}
        >
          {routine.title}
        </span>
        <span className="text-[10px] text-[var(--muted)] block truncate">
          {patternText}
        </span>
      </div>

      {/* Next occurrence badge */}
      {nextOccurrence && (
        <span className="text-[10px] text-[var(--muted)] shrink-0">
          {format(nextOccurrence, 'MMM d')}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RoutinesPanel
// ---------------------------------------------------------------------------

export function RoutinesPanel() {
  const { data: routines } = useRoutines()
  const { data: todayInstances } = useTodayRoutineInstances()
  const completeInstance = useCompleteRoutineInstance()
  const resetInstance = useResetRoutineInstance()
  const uiStore = useUIStore()

  const allRoutines = routines ?? []

  const instanceMap = React.useMemo(() => {
    const map: Record<string, RoutineInstance> = {}
    for (const inst of todayInstances ?? []) {
      map[inst.routine_id] = inst
    }
    return map
  }, [todayInstances])

  const handleComplete = React.useCallback(
    (routineId: string, date: string) => {
      completeInstance.mutate({ routine_id: routineId, date })
    },
    [completeInstance]
  )

  const handleUncomplete = React.useCallback(
    (routineId: string, date: string) => {
      resetInstance.mutate({ routine_id: routineId, date })
    },
    [resetInstance]
  )

  const handleClick = React.useCallback(
    (routineId: string) => {
      uiStore.openEditForm(routineId, 'routine')
    },
    [uiStore]
  )

  const handleCreate = React.useCallback(() => {
    uiStore.openEditForm(null, 'routine')
  }, [uiStore])

  const today = new Date()

  // Split into "Due Today" and "Upcoming"
  const dueToday = allRoutines.filter((r) => routineOccursOnDay(r, today))
  const upcoming = allRoutines.filter((r) => !routineOccursOnDay(r, today))

  const totalCount = allRoutines.length

  return (
    <div
      className="h-full overflow-y-auto flex flex-col"
      style={{
        backgroundColor: 'var(--bg)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Header with title and add button */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <div
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--muted)' }}
        >
          Routines
          {totalCount > 0 && (
            <span className="ml-1.5 tabular-nums">({totalCount})</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className={cn(
            'flex items-center justify-center w-6 h-6 rounded',
            'text-[var(--muted)] hover:text-[var(--fg)]',
            'hover:bg-[var(--surface-hover)] transition-colors duration-150'
          )}
          aria-label="Create routine"
          title="Create routine"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <Section
          title="Due Today"
          count={dueToday.length}
          icon={<Repeat2 size={14} className="shrink-0" />}
        >
          {dueToday.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              instance={instanceMap[routine.id]}
              onComplete={handleComplete}
              onUncomplete={handleUncomplete}
              onClick={handleClick}
            />
          ))}
        </Section>

        <Section
          title="Upcoming"
          count={upcoming.length}
          defaultOpen={false}
        >
          {upcoming.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              instance={instanceMap[routine.id]}
              onComplete={handleComplete}
              onUncomplete={handleUncomplete}
              onClick={handleClick}
            />
          ))}
        </Section>

        {totalCount === 0 && (
          <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">
            No routines yet
          </div>
        )}
      </div>
    </div>
  )
}
