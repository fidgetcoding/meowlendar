'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SearchResult } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'

type TaskTagRef = { task_id: string }

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string, types?: string[]) =>
    [...searchKeys.all, q, ...(types ?? [])] as const,
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

// ---------------------------------------------------------------------------
// Relevance scoring
// ---------------------------------------------------------------------------

type SearchResultType = SearchResult['type']

function scoreResult(result: SearchResult, query: string): number {
  const lowerTitle = result.title.toLowerCase()
  const lowerQuery = query.toLowerCase()

  if (lowerTitle === lowerQuery) return 3
  if (lowerTitle.startsWith(lowerQuery)) return 2
  if (lowerTitle.includes(lowerQuery)) return 1

  // Tag and attendee matches (surfaced in snippet) rank equal to title contains
  const lowerSnippet = result.snippet?.toLowerCase() ?? ''
  if (
    (lowerSnippet.startsWith('tag:') || lowerSnippet.startsWith('attendee:')) &&
    lowerSnippet.includes(lowerQuery)
  ) {
    return 1
  }

  return 0
}

// ---------------------------------------------------------------------------
// useSearch — debounced multi-table search
// ---------------------------------------------------------------------------

export function useSearch(
  query: string,
  types?: SearchResultType[],
) {
  const debouncedQuery = useDebouncedValue(query, 300)
  const supabase = createClient()

  const searchTypes = types ?? ['event', 'task', 'routine', 'booking_link']

  return useQuery({
    queryKey: searchKeys.query(debouncedQuery, searchTypes),
    queryFn: async (): Promise<SearchResult[]> => {
      const pattern = `%${debouncedQuery}%`
      const results: SearchResult[] = []

      const searches: Promise<void>[] = []

      const seenIds = new Set<string>()
      function pushUnique(item: SearchResult) {
        const key = `${item.type}:${item.id}`
        if (seenIds.has(key)) return
        seenIds.add(key)
        results.push(item)
      }

      if (searchTypes.includes('event')) {
        // Title + notes search
        searches.push(
          Promise.resolve(supabase
            .from('events')
            .select('id, title, notes, start_time')
            .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
            .limit(20)
            .then(({ data, error }) => {
              if (error) throw error
              if (data) {
                for (const row of data) {
                  pushUnique({
                    type: 'event',
                    id: row.id as string,
                    title: row.title as string,
                    date: row.start_time as string | null,
                    snippet: row.notes as string | null,
                  })
                }
              }
            })),
        )

        // Attendee email search
        searches.push(
          Promise.resolve(supabase
            .from('events')
            .select('id, title, notes, start_time, attendees')
            .or(`attendees::text.ilike.${pattern}`)
            .limit(20)
            .then(({ data, error }) => {
              if (error) throw error
              if (data) {
                for (const row of data) {
                  const attendees = (row.attendees ?? []) as { email: string; name?: string }[]
                  const matched = attendees.find(
                    (a) => a.email?.toLowerCase().includes(debouncedQuery.toLowerCase())
                  )
                  pushUnique({
                    type: 'event',
                    id: row.id as string,
                    title: row.title as string,
                    date: row.start_time as string | null,
                    snippet: matched
                      ? `Attendee: ${matched.email}`
                      : row.notes as string | null,
                  })
                }
              }
            })),
        )
      }

      if (searchTypes.includes('task')) {
        // Title + notes search
        searches.push(
          Promise.resolve(supabase
            .from('tasks')
            .select('id, title, notes, due_date')
            .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
            .limit(20)
            .then(({ data, error }) => {
              if (error) throw error
              if (data) {
                for (const row of data) {
                  pushUnique({
                    type: 'task',
                    id: row.id as string,
                    title: row.title as string,
                    date: row.due_date as string | null,
                    snippet: row.notes as string | null,
                  })
                }
              }
            })),
        )

        // Tag name search — find tasks via task_tags join
        searches.push(
          Promise.resolve(supabase
            .from('tags')
            .select('name, task_tags(task_id)')
            .ilike('name', pattern)
            .then(async ({ data: tagMatches, error }) => {
              if (error) throw error
              const tagTaskIds = tagMatches?.flatMap((t) =>
                ((t.task_tags as TaskTagRef[] | null) ?? []).map((tt) => tt.task_id)
              ) ?? []
              if (tagTaskIds.length === 0) return

              const { data: tagTasks, error: taskError } = await supabase
                .from('tasks')
                .select('id, title, notes, due_date')
                .in('id', tagTaskIds)
                .limit(20)
              if (taskError) throw taskError

              for (const row of tagTasks ?? []) {
                const matchedTagName = tagMatches?.find((tag) =>
                  ((tag.task_tags as TaskTagRef[] | null) ?? []).some((tt) => tt.task_id === row.id)
                )?.name
                pushUnique({
                  type: 'task',
                  id: row.id as string,
                  title: row.title as string,
                  date: row.due_date as string | null,
                  snippet: matchedTagName
                    ? `Tag: ${matchedTagName}`
                    : row.notes as string | null,
                })
              }
            })),
        )
      }

      if (searchTypes.includes('routine')) {
        searches.push(
          Promise.resolve(supabase
            .from('routines')
            .select('id, title, start_time')
            .ilike('title', pattern)
            .limit(20)
            .then(({ data, error }) => {
              if (error) throw error
              if (data) {
                for (const row of data) {
                  pushUnique({
                    type: 'routine',
                    id: row.id as string,
                    title: row.title as string,
                    date: row.start_time as string | null,
                    snippet: null,
                  })
                }
              }
            })),
        )
      }

      if (searchTypes.includes('booking_link')) {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')

        searches.push(
          Promise.resolve(supabase
            .from('booking_links')
            .select('id, name, slug, created_at')
            .eq('user_id', user.id)
            .or(`name.ilike.${pattern},slug.ilike.${pattern}`)
            .limit(20)
            .then(({ data, error }) => {
              if (error) throw error
              if (data) {
                for (const row of data) {
                  pushUnique({
                    type: 'booking_link',
                    id: row.id as string,
                    title: row.name as string,
                    date: row.created_at as string | null,
                    snippet: row.slug as string | null,
                  })
                }
              }
            })),
        )
      }

      await Promise.all(searches)

      // Sort by relevance: exact match > starts-with > contains
      results.sort((a, b) => {
        const scoreA = scoreResult(a, debouncedQuery)
        const scoreB = scoreResult(b, debouncedQuery)
        return scoreB - scoreA
      })

      return results
    },
    enabled: debouncedQuery.length >= 2,
    placeholderData: (prev) => prev,
  })
}
