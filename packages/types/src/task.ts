export type TaskStatus = 'backlog' | 'in_progress' | 'check' | 'done'
export type TaskBoard = 'current' | 'future'
export type TaskImportance = 'lowest' | 'low' | 'normal' | 'high' | 'highest'

export interface Subtask {
  id: string
  task_id: string
  title: string
  time_estimate_minutes: number | null
  completed: boolean
  position: number
  created_at: string
}

export interface Task {
  id: string
  user_id: string
  calendar_id: string | null
  parent_id: string | null
  title: string
  notes: string | null
  importance: TaskImportance
  time_estimate_minutes: number | null
  earliest_start: string | null
  due_date: string | null
  due_date_recurrence: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
  visibility: 'busy' | 'free'
  privacy: 'private' | 'public'
  flexibility: 'flexible' | 'not_flexible'
  status: TaskStatus
  board: TaskBoard
  is_split: boolean
  completed_at: string | null
  position: number | null
  reminders: { minutes_before: number }[]
  /** Link to a line in an Obsidian vault, `<vault name>:<line id>`. Null when unlinked. */
  vault_ref: string | null
  created_at: string
  updated_at: string
  subtasks?: Subtask[]
  tags?: import('./tag').Tag[]
  children?: Task[]
}
