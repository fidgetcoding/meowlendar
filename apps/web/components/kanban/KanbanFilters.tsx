'use client'

import { useState, useRef, useEffect } from 'react'
import { Filter, X, ChevronDown } from 'lucide-react'
import type { Tag, TaskImportance } from '@poolendar/types'

const IMPORTANCE_LEVELS: { value: TaskImportance; label: string; color: string }[] = [
  { value: 'highest', label: 'Highest', color: '#ef4444' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'normal', label: 'Normal', color: 'var(--muted)' },
  { value: 'low', label: 'Low', color: '#6b7280' },
  { value: 'lowest', label: 'Lowest', color: '#4b5563' },
]

export interface KanbanFilterState {
  tagIds: string[]
  importanceLevels: TaskImportance[]
}

interface KanbanFiltersProps {
  tags: Tag[]
  filters: KanbanFilterState
  onFiltersChange: (filters: KanbanFilterState) => void
}

export function KanbanFilters({
  tags,
  filters,
  onFiltersChange,
}: KanbanFiltersProps) {
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [importanceDropdownOpen, setImportanceDropdownOpen] = useState(false)
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const importanceDropdownRef = useRef<HTMLDivElement>(null)

  const hasActiveFilters =
    filters.tagIds.length > 0 || filters.importanceLevels.length > 0

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        tagDropdownRef.current &&
        !tagDropdownRef.current.contains(e.target as Node)
      ) {
        setTagDropdownOpen(false)
      }
      if (
        importanceDropdownRef.current &&
        !importanceDropdownRef.current.contains(e.target as Node)
      ) {
        setImportanceDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function toggleTag(tagId: string) {
    const next = filters.tagIds.includes(tagId)
      ? filters.tagIds.filter((id) => id !== tagId)
      : [...filters.tagIds, tagId]
    onFiltersChange({ ...filters, tagIds: next })
  }

  function toggleImportance(level: TaskImportance) {
    const next = filters.importanceLevels.includes(level)
      ? filters.importanceLevels.filter((l) => l !== level)
      : [...filters.importanceLevels, level]
    onFiltersChange({ ...filters, importanceLevels: next })
  }

  function clearAll() {
    onFiltersChange({ tagIds: [], importanceLevels: [] })
  }

  function getSelectedTagNames(): string[] {
    return filters.tagIds
      .map((id) => tags.find((t) => t.id === id)?.name)
      .filter(Boolean) as string[]
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter size={14} style={{ color: 'var(--muted)' }} />

      {/* Tag filter dropdown */}
      <div className="relative" ref={tagDropdownRef}>
        <button
          type="button"
          onClick={() => {
            setTagDropdownOpen(!tagDropdownOpen)
            setImportanceDropdownOpen(false)
          }}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors duration-150"
          style={{
            backgroundColor: filters.tagIds.length > 0
              ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
              : 'var(--surface)',
            borderColor: filters.tagIds.length > 0
              ? 'var(--accent)'
              : 'var(--border)',
            color: filters.tagIds.length > 0
              ? 'var(--accent)'
              : 'var(--muted)',
          }}
        >
          Tags
          {filters.tagIds.length > 0 && (
            <span
              className="px-1 rounded-sm text-xs font-medium"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
            >
              {filters.tagIds.length}
            </span>
          )}
          <ChevronDown size={12} />
        </button>

        {tagDropdownOpen && (
          <div
            className="absolute top-full left-0 mt-1 w-52 rounded-lg border shadow-xl z-50 py-1"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            {tags.length === 0 ? (
              <p
                className="px-3 py-2 text-xs"
                style={{ color: 'var(--muted)' }}
              >
                No tags available
              </p>
            ) : (
              tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors duration-100"
                  style={{ color: 'var(--fg)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <span
                    className="w-3 h-3 rounded-sm border flex items-center justify-center shrink-0"
                    style={{
                      borderColor: tag.color,
                      backgroundColor: filters.tagIds.includes(tag.id)
                        ? tag.color
                        : 'transparent',
                    }}
                  >
                    {filters.tagIds.includes(tag.id) && (
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                      >
                        <path
                          d="M1.5 4L3 5.5L6.5 2"
                          stroke="#000"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.prefix ? `${tag.prefix} ${tag.name}` : tag.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Importance filter dropdown */}
      <div className="relative" ref={importanceDropdownRef}>
        <button
          type="button"
          onClick={() => {
            setImportanceDropdownOpen(!importanceDropdownOpen)
            setTagDropdownOpen(false)
          }}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors duration-150"
          style={{
            backgroundColor: filters.importanceLevels.length > 0
              ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
              : 'var(--surface)',
            borderColor: filters.importanceLevels.length > 0
              ? 'var(--accent)'
              : 'var(--border)',
            color: filters.importanceLevels.length > 0
              ? 'var(--accent)'
              : 'var(--muted)',
          }}
        >
          Importance
          {filters.importanceLevels.length > 0 && (
            <span
              className="px-1 rounded-sm text-xs font-medium"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
            >
              {filters.importanceLevels.length}
            </span>
          )}
          <ChevronDown size={12} />
        </button>

        {importanceDropdownOpen && (
          <div
            className="absolute top-full left-0 mt-1 w-44 rounded-lg border shadow-xl z-50 py-1"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            {IMPORTANCE_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => toggleImportance(level.value)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors duration-100"
                style={{ color: 'var(--fg)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                <span
                  className="w-3 h-3 rounded-sm border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: level.color,
                    backgroundColor: filters.importanceLevels.includes(level.value)
                      ? level.color
                      : 'transparent',
                  }}
                >
                  {filters.importanceLevels.includes(level.value) && (
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 8 8"
                      fill="none"
                    >
                      <path
                        d="M1.5 4L3 5.5L6.5 2"
                        stroke="#000"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: level.color }}
                />
                {level.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {getSelectedTagNames().map((name) => {
        const tag = tags.find((t) => t.name === name)
        return (
          <span
            key={name}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
            style={{
              backgroundColor: `${tag?.color ?? 'var(--muted)'}22`,
              color: tag?.color ?? 'var(--muted)',
            }}
          >
            {name}
            <button
              type="button"
              onClick={() => {
                if (tag) toggleTag(tag.id)
              }}
              className="hover:opacity-70"
            >
              <X size={10} />
            </button>
          </span>
        )
      })}

      {filters.importanceLevels.map((level) => {
        const info = IMPORTANCE_LEVELS.find((l) => l.value === level)
        return (
          <span
            key={level}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
            style={{
              backgroundColor: `${info?.color ?? 'var(--muted)'}22`,
              color: info?.color ?? 'var(--muted)',
            }}
          >
            {info?.label}
            <button
              type="button"
              onClick={() => toggleImportance(level)}
              className="hover:opacity-70"
            >
              <X size={10} />
            </button>
          </span>
        )
      })}

      {/* Clear all */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs px-2 py-1 rounded-md transition-colors duration-150"
          style={{ color: 'var(--muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--destructive)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--muted)'
          }}
        >
          Clear all
        </button>
      )}
    </div>
  )
}
