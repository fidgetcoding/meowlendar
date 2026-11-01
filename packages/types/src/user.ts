export interface Profile {
  id: string
  username: string
  display_name: string | null
  company: string | null
  avatar_url: string | null
  settings: UserSettings
  created_at: string
  updated_at: string
}

export interface UserSettings {
  default_event_calendar_id: string | null
  default_task_calendar_id: string | null
  privacy_default: 'private' | 'public'
  busy_free_default: 'busy' | 'free'
  move_due_date_behavior: 'ask' | 'always' | 'never'
  auto_assign_due_dates: boolean
  timezone: string
  time_format: '12h' | '24h'
  language: string
  first_day_of_week: 'sunday' | 'monday'
  initial_view: 'day' | 'week' | 'month'
  theme_accent_color: string
  time_grid_start: string
  time_grid_end: string
  time_display_resolution: number
  time_drag_resolution: number
  default_task_duration_minutes: number
  limit_events_per_day: number
  undo_grace_period_seconds: number
  show_weekends: boolean
  widen_current_day: boolean
  dim_past_events: boolean
  show_completed_tasks: boolean
  show_declined_events: boolean
  merge_duplicate_events: boolean
  background_density: 'compact' | 'comfortable' | 'spacious'
  notifications: NotificationSettings
  telegram_chat_id: string | null
  booking_page_title: string | null
  booking_page_welcome: string | null
  booking_page_brand_color: string | null
  booking_page_logo_url: string | null
  booking_page_show_poolendar_branding: boolean
}

export interface NotificationSettings {
  browser_push: NotificationChannelConfig
  email: NotificationChannelConfig
  in_app: NotificationChannelConfig
  telegram: NotificationChannelConfig
}

export interface NotificationChannelConfig {
  enabled: boolean
  reminders: boolean
  due_dates: boolean
  bookings: boolean
  schedule_changes: boolean
}
