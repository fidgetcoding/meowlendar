import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Dexie before importing db module.
// vi.hoisted runs before module evaluation so the mock factory can reference them.
// ---------------------------------------------------------------------------

const { mockStores, mockVersion } = vi.hoisted(() => {
  const mockStores = vi.fn()
  const mockVersion = vi.fn(() => ({ stores: mockStores }))
  return { mockStores, mockVersion }
})

vi.mock('dexie', () => {
  class MockDexie {
    events: unknown
    tasks: unknown
    subtasks: unknown
    routines: unknown
    routineInstances: unknown
    mutationQueue: unknown

    version = mockVersion

    constructor(public dbName: string) {}
  }

  return { default: MockDexie }
})

// Import after mocking
import { db } from '../db'
import type {
  OfflineEvent,
  OfflineTask,
  OfflineSubtask,
  OfflineRoutine,
  OfflineRoutineInstance,
  MutationQueueEntry,
} from '../db'

// ---------------------------------------------------------------------------
// Database constructor
// ---------------------------------------------------------------------------

describe('PoolendarDB - schema definition', () => {
  it('creates a database named PoolendarDB', () => {
    expect((db as unknown as { dbName: string }).dbName).toBe('PoolendarDB')
  })

  it('declares version 1', () => {
    expect(mockVersion).toHaveBeenCalledWith(1)
  })

  it('defines all required tables with correct indexes', () => {
    expect(mockStores).toHaveBeenCalledWith({
      events:
        'id, [user_id+start_time], [user_id+end_time], calendar_id, google_event_id',
      tasks:
        'id, [user_id+status+board], parent_id, [user_id+scheduled_start], [user_id+due_date]',
      subtasks: 'id, task_id, [task_id+position]',
      routines: 'id, user_id',
      routineInstances: 'id, [routine_id+date]',
      mutationQueue: '++id, timestamp',
    })
  })
})

// ---------------------------------------------------------------------------
// Interface shape tests (compile-time via type assertions, runtime via object)
// ---------------------------------------------------------------------------

describe('PoolendarDB - interface shapes', () => {
  it('OfflineEvent has required fields', () => {
    const event: OfflineEvent = {
      id: 'evt-1',
      user_id: 'user-1',
      calendar_id: 'cal-1',
      google_event_id: null,
      title: 'Meeting',
      notes: null,
      start_time: '2026-06-15T09:00:00Z',
      end_time: '2026-06-15T10:00:00Z',
      timezone: 'America/New_York',
      is_all_day: false,
      location: null,
      color_override: null,
      visibility: 'default',
      privacy: 'default',
      conferencing_url: null,
      recurrence_rule: null,
      attendees: [],
      reminders: [],
      status: 'confirmed',
      sync_status: 'synced',
      etag: null,
      created_at: '2026-06-15T08:00:00Z',
      updated_at: '2026-06-15T08:00:00Z',
    }
    expect(event.id).toBe('evt-1')
    expect(event.is_all_day).toBe(false)
  })

  it('OfflineTask has required fields', () => {
    const task: OfflineTask = {
      id: 'task-1',
      user_id: 'user-1',
      calendar_id: null,
      parent_id: null,
      title: 'Write tests',
      notes: null,
      importance: 'normal',
      time_estimate_minutes: 30,
      earliest_start: null,
      due_date: '2026-06-20',
      scheduled_start: null,
      scheduled_end: null,
      status: 'backlog',
      board: 'current',
      is_split: false,
      completed_at: null,
      position: 0,
      reminders: [],
      created_at: '2026-06-15T08:00:00Z',
      updated_at: '2026-06-15T08:00:00Z',
    }
    expect(task.board).toBe('current')
    expect(task.status).toBe('backlog')
  })

  it('OfflineSubtask has required fields', () => {
    const subtask: OfflineSubtask = {
      id: 'sub-1',
      task_id: 'task-1',
      title: 'Sub item',
      time_estimate_minutes: null,
      completed: false,
      position: 0,
      created_at: '2026-06-15T08:00:00Z',
    }
    expect(subtask.task_id).toBe('task-1')
    expect(subtask.completed).toBe(false)
  })

  it('OfflineRoutine has required fields', () => {
    const routine: OfflineRoutine = {
      id: 'r-1',
      user_id: 'user-1',
      title: 'Morning standup',
      notes: null,
      start_time: '09:00',
      end_time: '09:30',
      timezone: 'America/New_York',
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      location: null,
      visibility: 'busy',
      privacy: 'default',
      reminders: [],
      created_at: '2026-06-15T08:00:00Z',
      updated_at: '2026-06-15T08:00:00Z',
    }
    expect(routine.recurrence_rule).toContain('FREQ=WEEKLY')
  })

  it('OfflineRoutineInstance has required fields', () => {
    const instance: OfflineRoutineInstance = {
      id: 'ri-1',
      routine_id: 'r-1',
      date: '2026-06-15',
      status: 'pending',
      completed_at: null,
    }
    expect(instance.routine_id).toBe('r-1')
  })

  it('MutationQueueEntry has required fields', () => {
    const entry: MutationQueueEntry = {
      method: 'POST',
      table: 'events',
      entityId: 'evt-1',
      data: { title: 'New event' },
      timestamp: Date.now(),
      retries: 0,
    }
    expect(entry.method).toBe('POST')
    expect(entry.retries).toBe(0)
  })

  it('MutationQueueEntry id is optional (auto-increment)', () => {
    const entry: MutationQueueEntry = {
      id: 42,
      method: 'DELETE',
      table: 'tasks',
      entityId: 'task-1',
      data: null,
      timestamp: Date.now(),
      retries: 0,
    }
    expect(entry.id).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Index coverage
// ---------------------------------------------------------------------------

describe('PoolendarDB - index coverage', () => {
  it('events table indexes support user+time range queries', () => {
    const call = mockStores.mock.calls[0]![0]
    expect(call.events).toContain('[user_id+start_time]')
    expect(call.events).toContain('[user_id+end_time]')
    expect(call.events).toContain('calendar_id')
  })

  it('tasks table indexes support board queries and date filters', () => {
    const call = mockStores.mock.calls[0]![0]
    expect(call.tasks).toContain('[user_id+status+board]')
    expect(call.tasks).toContain('[user_id+scheduled_start]')
    expect(call.tasks).toContain('[user_id+due_date]')
    expect(call.tasks).toContain('parent_id')
  })

  it('subtasks table indexes support task lookup', () => {
    const call = mockStores.mock.calls[0]![0]
    expect(call.subtasks).toContain('task_id')
    expect(call.subtasks).toContain('[task_id+position]')
  })

  it('mutationQueue uses auto-increment id and timestamp index', () => {
    const call = mockStores.mock.calls[0]![0]
    expect(call.mutationQueue).toContain('++id')
    expect(call.mutationQueue).toContain('timestamp')
  })
})
