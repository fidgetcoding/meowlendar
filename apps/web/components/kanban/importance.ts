import type { TaskImportance } from '@poolendar/types'

/** Board importance pills. The beige cat is medium priority, so its pill says "Medium". */
export const IMPORTANCE_PILL: Record<TaskImportance, { label: string; color: string }> = {
  highest: { label: 'Highest', color: '#c8432f' },
  high: { label: 'High', color: '#e07a12' },
  normal: { label: 'Medium', color: '#d6b48a' },
  low: { label: 'Low', color: '#8b7d69' },
  lowest: { label: 'Lowest', color: '#6d6152' },
}
