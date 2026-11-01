import type {
  CalendarEvent,
  CalendarItem,
  Task,
  Routine,
  BookingLink,
  Booking,
  Calendar,
  Tag,
  Schedule,
  Subtask,
  Profile,
  ApiKey,
  Paginated,
  SearchResult,
} from '@poolendar/types'

export interface ClientConfig {
  baseUrl: string
  apiKey?: string
  token?: string
}

/** Cursor-pagination params accepted by every list endpoint (spec #76). */
export interface PageParams {
  cursor?: string
  limit?: number
}

/** A connected Google account grouped with its sub-calendars (GET /api/calendars). */
export interface CalendarAccount {
  id: string
  email: string
  calendars: Calendar[]
  [key: string]: unknown
}

export class PoolendarClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.headers = { 'Content-Type': 'application/json' }
    if (config.apiKey) this.headers['Authorization'] = `Bearer ${config.apiKey}`
    if (config.token) this.headers['Authorization'] = `Bearer ${config.token}`
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...init?.headers },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body.error ?? res.statusText)
    }
    // DELETE routes answer 204 with no body, and parsing that would throw.
    if (res.status === 204) return undefined as T
    return res.json()
  }

  // Calendars
  async listCalendars() { return this.request<{ accounts: CalendarAccount[] }>('/api/calendars') }

  // Events — unions events + scheduled tasks (+ routine instances) in the window
  // per spec #22. Each item carries a `kind` discriminator. `include` narrows
  // the kinds (default: events,tasks,routines).
  async listEvents(
    params: { start: string; end: string; calendar_id?: string; include?: string } & PageParams
  ) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value))
      }
    })
    const q = searchParams.toString()
    return this.request<Paginated<CalendarItem>>(`/api/events${q ? `?${q}` : ''}`)
  }
  async getEvent(id: string) { return this.request<CalendarEvent>(`/api/events/${seg(id)}`) }
  async createEvent(data: Partial<CalendarEvent>) { return this.request<CalendarEvent>('/api/events', { method: 'POST', body: JSON.stringify(data) }) }
  async updateEvent(id: string, data: Partial<CalendarEvent>) { return this.request<CalendarEvent>(`/api/events/${seg(id)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteEvent(id: string) { return this.request<void>(`/api/events/${seg(id)}`, { method: 'DELETE' }) }
  async rsvpEvent(eventId: string, data: { response: 'accepted' | 'declined' | 'tentative' }) {
    return this.request(`/api/events/${seg(eventId)}/rsvp`, { method: 'POST', body: JSON.stringify(data) })
  }

  // Tasks
  async listTasks(
    params?: {
      status?: string
      board?: string
      parent_id?: string
      include_children?: boolean
      scheduled_from?: string
      scheduled_to?: string
      due_from?: string
      due_to?: string
      tag_id?: string
    } & PageParams
  ) {
    const searchParams = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value))
        }
      })
    }
    const q = searchParams.toString()
    return this.request<Paginated<Task>>(`/api/tasks${q ? `?${q}` : ''}`)
  }
  async getTask(id: string) { return this.request<Task>(`/api/tasks/${seg(id)}`) }
  async createTask(data: Partial<Task>) { return this.request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(data) }) }
  async updateTask(id: string, data: Partial<Task>) { return this.request<Task>(`/api/tasks/${seg(id)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteTask(id: string) { return this.request<void>(`/api/tasks/${seg(id)}`, { method: 'DELETE' }) }
  async moveTask(id: string, data: { status?: string; position?: number; board?: string }) { return this.request<Task>(`/api/tasks/${seg(id)}/move`, { method: 'POST', body: JSON.stringify(data) }) }
  // Split into N equal chunks when the task has no subtasks; the route expects a
  // number, not an array of chunk objects.
  async splitTask(id: string, data?: { chunks?: number }) { return this.request<Task & { children: Task[] }>(`/api/tasks/${seg(id)}/split`, { method: 'POST', body: data ? JSON.stringify(data) : undefined }) }
  async scheduleTask(id: string, data: { scheduled_start: string; scheduled_end: string }) { return this.request<Task>(`/api/tasks/${seg(id)}/schedule`, { method: 'POST', body: JSON.stringify(data) }) }
  async reflowDay(data: { date: string; timezone?: string }) { return this.request<{ date: string; timezone: string; moved: number; tasks: Task[] }>('/api/tasks/reflow', { method: 'POST', body: JSON.stringify(data) }) }
  async completeTask(id: string) { return this.request<Task>(`/api/tasks/${seg(id)}/complete`, { method: 'POST' }) }
  async reopenTask(id: string) { return this.request<Task>(`/api/tasks/${seg(id)}/reopen`, { method: 'POST' }) }

  // Subtasks
  async listSubtasks(taskId: string) { return this.request<Subtask[]>(`/api/tasks/${seg(taskId)}/subtasks`) }
  async createSubtask(taskId: string, data: Partial<Subtask>) { return this.request<Subtask>(`/api/tasks/${seg(taskId)}/subtasks`, { method: 'POST', body: JSON.stringify(data) }) }
  async updateSubtask(taskId: string, subtaskId: string, data: Partial<Subtask>) { return this.request<Subtask>(`/api/tasks/${seg(taskId)}/subtasks/${seg(subtaskId)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteSubtask(taskId: string, subtaskId: string) { return this.request<void>(`/api/tasks/${seg(taskId)}/subtasks/${seg(subtaskId)}`, { method: 'DELETE' }) }
  // The reorder route expects `subtask_ids` (the ordered id list), not `order`.
  async reorderSubtasks(taskId: string, order: string[]) { return this.request<Subtask[]>(`/api/tasks/${seg(taskId)}/subtasks/reorder`, { method: 'POST', body: JSON.stringify({ subtask_ids: order }) }) }

  // Routines
  async listRoutines(params?: PageParams) { return this.request<Paginated<Routine>>(`/api/routines${qs(params)}`) }
  async getRoutine(id: string) { return this.request<Routine>(`/api/routines/${seg(id)}`) }
  async createRoutine(data: Partial<Routine>) { return this.request<Routine>('/api/routines', { method: 'POST', body: JSON.stringify(data) }) }
  async updateRoutine(id: string, data: Partial<Routine>) { return this.request<Routine>(`/api/routines/${seg(id)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteRoutine(id: string) { return this.request<void>(`/api/routines/${seg(id)}`, { method: 'DELETE' }) }
  async listRoutineInstances(routineId: string, params: { start: string; end: string }) {
    const searchParams = new URLSearchParams({ start: params.start, end: params.end })
    return this.request(`/api/routines/${seg(routineId)}/instances?${searchParams}`)
  }
  async updateRoutineInstance(routineId: string, date: string, data: { status: 'completed' | 'skipped' }) {
    return this.request(`/api/routines/${seg(routineId)}/instances/${seg(date)}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  // Tags
  async listTags(params?: PageParams) { return this.request<Paginated<Tag>>(`/api/tags${qs(params)}`) }
  async createTag(data: { name: string; color: string; prefix?: string }) { return this.request<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(data) }) }
  async getTag(id: string) { return this.request<Tag>(`/api/tags/${seg(id)}`) }
  async updateTag(id: string, data: Partial<Tag>) { return this.request<Tag>(`/api/tags/${seg(id)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteTag(id: string) { return this.request<void>(`/api/tags/${seg(id)}`, { method: 'DELETE' }) }

  // Booking Links
  async listBookingLinks(params?: PageParams) { return this.request<Paginated<BookingLink>>(`/api/booking-links${qs(params)}`) }
  async getBookingLink(id: string) { return this.request<BookingLink>(`/api/booking-links/${seg(id)}`) }
  async createBookingLink(data: Partial<BookingLink>) { return this.request<BookingLink>('/api/booking-links', { method: 'POST', body: JSON.stringify(data) }) }
  async updateBookingLink(id: string, data: Partial<BookingLink>) { return this.request<BookingLink>(`/api/booking-links/${seg(id)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteBookingLink(id: string) { return this.request<void>(`/api/booking-links/${seg(id)}`, { method: 'DELETE' }) }

  // Bookings — canonical slug-based external routes (spec #75) + host bookings list.
  async listBookings(linkId: string, params?: PageParams) {
    const sp = new URLSearchParams()
    sp.set('link_id', linkId)
    if (params?.cursor) sp.set('cursor', params.cursor)
    if (params?.limit != null) sp.set('limit', String(params.limit))
    return this.request<Paginated<Booking>>(`/api/booking/bookings?${sp}`)
  }
  async approveBooking(id: string) { return this.request<Booking>(`/api/booking/bookings/${seg(id)}/approve`, { method: 'POST' }) }
  async declineBooking(id: string) { return this.request<Booking>(`/api/booking/bookings/${seg(id)}/decline`, { method: 'POST' }) }
  async bookSlot(slug: string, data: { booker_name: string; booker_email: string; start_time: string }) { return this.request<Booking>(`/api/booking/book/${seg(slug)}`, { method: 'POST', body: JSON.stringify(data) }) }
  async getAvailability(slug: string, params: { start: string; end: string; timezone?: string }) {
    const searchParams = new URLSearchParams()
    searchParams.set('start', params.start)
    searchParams.set('end', params.end)
    if (params.timezone) searchParams.set('timezone', params.timezone)
    return this.request(`/api/booking/availability/${seg(slug)}?${searchParams}`)
  }

  // Schedules
  async listSchedules() { return this.request<Schedule[]>('/api/schedules') }
  async getSchedule(id: string) { return this.request<Schedule>(`/api/schedules/${seg(id)}`) }
  async createSchedule(data: Partial<Schedule>) { return this.request<Schedule>('/api/schedules', { method: 'POST', body: JSON.stringify(data) }) }
  async updateSchedule(id: string, data: Partial<Schedule>) { return this.request<Schedule>(`/api/schedules/${seg(id)}`, { method: 'PATCH', body: JSON.stringify(data) }) }
  async deleteSchedule(id: string) { return this.request<void>(`/api/schedules/${seg(id)}`, { method: 'DELETE' }) }

  // Undo
  async undo() { return this.request<any>('/api/undo', { method: 'POST' }) }

  // Google Sync
  async triggerGoogleSync() { return this.request<any>('/api/google/sync', { method: 'POST' }) }

  // Convert
  async convert(data: { source_type: string; source_id: string; target_type: string; calendar_id?: string; repeat_pattern?: string }) { return this.request<CalendarEvent | Task | Routine>('/api/convert', { method: 'POST', body: JSON.stringify(data) }) }

  // Search
  async search(q: string, types?: string[], page?: PageParams) {
    const params = new URLSearchParams({ q })
    if (types?.length) {
      params.set('types', types.join(','))
    }
    if (page?.cursor) params.set('cursor', page.cursor)
    if (page?.limit != null) params.set('limit', String(page.limit))
    return this.request<Paginated<SearchResult>>(`/api/search?${params}`)
  }

  // Profile
  async getProfile() { return this.request<Profile>('/api/profile') }
  async updateProfile(data: Partial<Profile>) { return this.request<Profile>('/api/profile', { method: 'PATCH', body: JSON.stringify(data) }) }

  // Account
  async deleteAccount() { await this.request<void>('/api/auth/delete-account', { method: 'DELETE' }) }

  // API Keys
  async listApiKeys() { return this.request<ApiKey[]>('/api/api-keys') }
  async createApiKey(name: string) { return this.request<ApiKey & { key: string }>('/api/api-keys', { method: 'POST', body: JSON.stringify({ name }) }) }
  async deleteApiKey(id: string) { return this.request<void>(`/api/api-keys/${seg(id)}`, { method: 'DELETE' }) }
}

/**
 * Encode a value for use as one URL path segment. A dot segment survives
 * encoding and would be collapsed by URL parsing, so it is refused outright.
 */
function seg(value: string): string {
  const text = String(value)
  if (text === '' || text === '.' || text === '..') {
    throw new Error(`Invalid path segment: "${text}"`)
  }
  return encodeURIComponent(text)
}

/** Build a `?cursor=&limit=` query suffix for a list request (empty when unset). */
function qs(params?: PageParams): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  if (params.cursor) sp.set('cursor', params.cursor)
  if (params.limit != null) sp.set('limit', String(params.limit))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}
