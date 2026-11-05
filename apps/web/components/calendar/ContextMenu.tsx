'use client'

import * as React from 'react'
import {
  Calendar,
  CheckSquare,
  RefreshCw,
  Edit,
  Trash2,
  Copy,
  ArrowRightLeft,
  Video,
  Link2,
  Mail,
  SkipForward,
  Check,
  Scissors,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/lib/stores/ui-store'

// ---------------------------------------------------------------------------
// Menu item
// ---------------------------------------------------------------------------

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}

function MenuItem({ icon, label, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 w-full px-3 py-1.5 text-sm',
        'hover:bg-[var(--surface-hover)] rounded transition-colors duration-100',
        danger ? 'text-red-400 hover:text-red-300' : 'text-[var(--fg)]'
      )}
    >
      <span className="shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-[var(--border)]" />
}

const COLOR_SWATCHES = [
  '#e8930c',
  '#5a68d4',
  '#cf5d78',
  '#2b93b4',
  '#3dab63',
  '#6f7ae0',
  '#c8432f',
  '#8b7d69',
]

function ColorRow({ onPick }: { onPick: (color: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5">
      {COLOR_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onPick(color)}
          aria-label={`Set color ${color}`}
          className="w-4 h-4 rounded-full border border-black/20 hover:scale-110 transition-transform"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContextMenu
// ---------------------------------------------------------------------------

export interface ContextMenuItem {
  type: 'event' | 'task' | 'routine'
  conferencingUrl?: string | null
  attendeeEmails?: string[]
}

interface ContextMenuProps {
  /** Resolved item for the open menu, or null for an empty-slot right-click. */
  item: ContextMenuItem | null
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onComplete: () => void
  onSkip: () => void
  onConvert: (target: 'event' | 'task' | 'routine') => void
  onSplit: () => void
  onColorOverride: (color: string) => void
  onJoin: () => void
  onCopyMeetingLink: () => void
  onEmailAttendees: () => void
  onCreate: (type: 'event' | 'task' | 'routine') => void
}

export function ContextMenu({
  item,
  onEdit,
  onDelete,
  onDuplicate,
  onComplete,
  onSkip,
  onConvert,
  onSplit,
  onColorOverride,
  onJoin,
  onCopyMeetingLink,
  onEmailAttendees,
  onCreate,
}: ContextMenuProps) {
  const { contextMenu, closeContextMenu } = useUIStore()
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!contextMenu.isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeContextMenu()
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu.isOpen, closeContextMenu])

  if (!contextMenu.isOpen || !contextMenu.position) return null

  const { x, y } = contextMenu.position
  const hasItem = !!contextMenu.itemId && !!item

  const menuWidth = 208
  const menuHeight = hasItem ? 280 : 140
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8)
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8)

  function run(fn: () => void) {
    fn()
    closeContextMenu()
  }

  const isEvent = item?.type === 'event'
  const isTask = item?.type === 'task'
  const isRoutine = item?.type === 'routine'
  const hasMeeting = Boolean(item?.conferencingUrl)
  const hasAttendees = (item?.attendeeEmails?.length ?? 0) > 0

  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 min-w-[208px] rounded-lg py-1 shadow-xl',
        'border border-[var(--border)] bg-[var(--surface)]',
        'animate-in fade-in zoom-in-95 duration-100'
      )}
      style={{ left: adjustedX, top: adjustedY }}
      role="menu"
    >
      {hasItem ? (
        <>
          <MenuItem icon={<Edit size={14} />} label="Edit" onClick={() => run(onEdit)} />

          <ColorRow onPick={(color) => run(() => onColorOverride(color))} />
          <MenuDivider />

          {isEvent && hasMeeting && (
            <>
              <MenuItem icon={<Video size={14} />} label="Join meeting" onClick={() => run(onJoin)} />
              <MenuItem
                icon={<Link2 size={14} />}
                label="Copy meeting link"
                onClick={() => run(onCopyMeetingLink)}
              />
            </>
          )}
          {isEvent && hasAttendees && (
            <MenuItem
              icon={<Mail size={14} />}
              label="Email attendees"
              onClick={() => run(onEmailAttendees)}
            />
          )}

          {(isTask || isRoutine) && (
            <MenuItem
              icon={<Check size={14} />}
              label="Complete"
              onClick={() => run(onComplete)}
            />
          )}
          {isRoutine && (
            <MenuItem
              icon={<SkipForward size={14} />}
              label="Skip"
              onClick={() => run(onSkip)}
            />
          )}

          <MenuItem icon={<Copy size={14} />} label="Copy" onClick={() => run(onDuplicate)} />

          {(isTask || isRoutine) && (
            <>
              <MenuDivider />
              {!isEvent && (
                <MenuItem
                  icon={<ArrowRightLeft size={14} />}
                  label="Convert to Event"
                  onClick={() => run(() => onConvert('event'))}
                />
              )}
              {!isTask && (
                <MenuItem
                  icon={<ArrowRightLeft size={14} />}
                  label="Convert to Task"
                  onClick={() => run(() => onConvert('task'))}
                />
              )}
              {!isRoutine && (
                <MenuItem
                  icon={<ArrowRightLeft size={14} />}
                  label="Convert to Routine"
                  onClick={() => run(() => onConvert('routine'))}
                />
              )}
              {isTask && (
                <MenuItem
                  icon={<Scissors size={14} />}
                  label="Split"
                  onClick={() => run(onSplit)}
                />
              )}
            </>
          )}

          <MenuDivider />
          <MenuItem
            icon={<Trash2 size={14} />}
            label="Delete"
            onClick={() => run(onDelete)}
            danger
          />
        </>
      ) : (
        <>
          <MenuItem
            icon={<Calendar size={14} />}
            label="Create Event"
            onClick={() => run(() => onCreate('event'))}
          />
          <MenuItem
            icon={<CheckSquare size={14} />}
            label="Create Task"
            onClick={() => run(() => onCreate('task'))}
          />
          <MenuItem
            icon={<RefreshCw size={14} />}
            label="Create Routine"
            onClick={() => run(() => onCreate('routine'))}
          />
        </>
      )}
    </div>
  )
}
