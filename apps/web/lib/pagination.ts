// ---------------------------------------------------------------------------
// Cursor pagination (spec #76).
//
// Every list endpoint returns `{ items, next_cursor }`. Callers may pass
// `cursor` and `limit` (max 100). With neither, the full result set is returned
// and `next_cursor` is null — backward-compatible content in the enveloped
// shape.
//
// Endpoints read complete, stably ordered server pages before merging/filtering.
// This helper retains the existing public cursor semantics over those results.
// The cursor is the stable key of the last returned item; a deleted cursor row
// restarts from the top, as before.
// ---------------------------------------------------------------------------

export const MAX_PAGE_LIMIT = 100

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}

/** Parse `limit` (clamped to 1..100). Returns null when absent/invalid → no limit. */
export function parseLimit(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get('limit')
  if (raw === null) return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || n < 1) return null
  return Math.min(n, MAX_PAGE_LIMIT)
}

function encodeCursor(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function decodeCursor(raw: string): string | null {
  try {
    return Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Slice an already-ordered array into a page + next cursor.
 *
 * @param all   the full, ordered result set
 * @param searchParams  the request's query params (`cursor`, `limit`)
 * @param keyOf stable per-item key (defaults to `item.id`)
 */
export function paginate<T>(
  all: T[],
  searchParams: URLSearchParams,
  keyOf: (item: T) => string = (item) => (item as { id: string }).id
): Paginated<T> {
  const limit = parseLimit(searchParams)
  const cursorRaw = searchParams.get('cursor')

  let start = 0
  if (cursorRaw) {
    const key = decodeCursor(cursorRaw)
    if (key !== null) {
      const idx = all.findIndex((item) => keyOf(item) === key)
      start = idx >= 0 ? idx + 1 : 0
    }
  }

  const items = limit === null ? all.slice(start) : all.slice(start, start + limit)
  const consumed = start + items.length
  const hasMore = limit !== null && consumed < all.length && items.length > 0
  const next_cursor = hasMore ? encodeCursor(keyOf(items[items.length - 1]!)) : null

  return { items, next_cursor }
}
