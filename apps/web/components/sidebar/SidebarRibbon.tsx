'use client'

import * as React from 'react'
import {
  CalendarDays,
  Link2,
  Clock,
  Moon,
  Settings,
  Sun,
  PanelLeftOpen,
  PanelLeftClose,
  SquareCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/lib/theme'
import { CatMark } from '@/components/brand/Wordmark'

interface SidebarRibbonProps {
  activePanel: 'tasks' | 'calendar' | 'booking' | 'schedules' | null
  isExpanded: boolean
  onToggleTasks: () => void
  onCalendarView: () => void
  onToggleBooking: () => void
  onSettings: () => void
  onToggleExpand: () => void
}

type NavItem = {
  id: 'tasks' | 'calendar' | 'booking' | 'schedules'
  label: string
  icon: typeof SquareCheck
  onClick: () => void
  disabled?: boolean
}

function Tooltip({
  label,
  visible,
  children,
}: {
  label: string
  visible: boolean
  children: React.ReactNode
}) {
  const [show, setShow] = React.useState(false)

  if (!visible) {
    return <>{children}</>
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          role="tooltip"
          className={cn(
            'absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2',
            'whitespace-nowrap rounded-md px-2.5 py-1',
            'bg-[var(--surface)] text-xs text-[var(--fg)]',
            'border border-[var(--border)]',
            'pointer-events-none shadow-lg'
          )}
        >
          {label}
        </div>
      )}
    </div>
  )
}

function ThemeToggleButton({ isExpanded }: { isExpanded: boolean }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? 'Light mode' : 'Dark mode'
  const Icon = isDark ? Sun : Moon

  return (
    <Tooltip label={label} visible={!isExpanded}>
      <button type="button" onClick={toggleTheme} aria-label={label} className="meow-rib-b">
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
        {isExpanded && <span className="truncate">{label}</span>}
      </button>
    </Tooltip>
  )
}

/** The pale left rail: periwinkle cat-o on top, labelled icons, theme / settings / expand at the foot. */
export function SidebarRibbon({
  activePanel,
  isExpanded,
  onToggleTasks,
  onCalendarView,
  onToggleBooking,
  onSettings,
  onToggleExpand,
}: SidebarRibbonProps) {
  const navItems: NavItem[] = [
    { id: 'tasks', label: 'Tasks', icon: SquareCheck, onClick: onToggleTasks },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, onClick: onCalendarView },
    { id: 'booking', label: 'Booking', icon: Link2, onClick: onToggleBooking },
    { id: 'schedules', label: 'Schedules', icon: Clock, onClick: () => {}, disabled: true },
  ]

  return (
    <nav aria-label="Main navigation" className={cn('meow-rib', isExpanded && 'is-expanded')}>
      <button type="button" onClick={onCalendarView} className="meow-rib-mark" aria-label="Meowlendar">
        <CatMark />
      </button>

      <div className="meow-rib-items">
        {navItems.map((item) => {
          const active = activePanel === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              disabled={item.disabled}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={cn('meow-rib-it', active && 'is-on')}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.6} />
              <span aria-hidden="true">{item.label}</span>
            </button>
          )
        })}
      </div>

      <span className="flex-1" />

      <div className="meow-rib-foot">
        <ThemeToggleButton isExpanded={isExpanded} />

        <Tooltip label="Settings" visible={!isExpanded}>
          <button type="button" onClick={onSettings} aria-label="Settings" className="meow-rib-b">
            <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
            {isExpanded && <span className="truncate">Settings</span>}
          </button>
        </Tooltip>

        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="meow-rib-b"
        >
          {isExpanded ? (
            <>
              <PanelLeftClose className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
              <span className="truncate">Collapse</span>
            </>
          ) : (
            <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
          )}
        </button>
      </div>
    </nav>
  )
}
