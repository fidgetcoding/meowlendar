'use client'

import {
  CalendarDays,
  CheckSquare,
  LayoutGrid,
  ExternalLink,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TabId = 'calendar' | 'tasks' | 'kanban' | 'booking' | 'settings'

interface BottomTabBarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const TABS: { id: TabId; label: string; icon: typeof CalendarDays }[] = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { id: 'booking', label: 'Bookings', icon: ExternalLink },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50',
        'flex items-center justify-around gap-1 px-1.5 pt-1',
        'border-t border-[color-mix(in_srgb,var(--peri)_26%,transparent)] bg-[var(--peril)]',
        'md:hidden'
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id
        const Icon = tab.icon

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center justify-center gap-1',
              'flex-1 my-1 py-1.5 rounded-xl',
              'transition-colors duration-150',
              active
                ? 'bg-[var(--railon)] text-[var(--ink)] shadow-[0_1px_2px_rgba(81,93,203,.14),0_8px_16px_-10px_rgba(81,93,203,.55)] [&>svg]:text-[var(--perid)]'
                : 'text-[var(--perik)] active:text-[var(--ink)]'
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.6} />
            <span className="text-[10.5px] font-semibold leading-none">
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
