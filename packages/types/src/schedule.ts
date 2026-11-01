export interface Schedule {
  id: string
  user_id: string
  name: string
  /** `day` runs from 0 (Sunday) to 6. */
  time_blocks: { day: number; start: string; end: string }[]
  created_at: string
  updated_at: string
}
