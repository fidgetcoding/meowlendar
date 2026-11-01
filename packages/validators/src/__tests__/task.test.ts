import { describe, it, expect } from 'vitest'
import {
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
  splitTaskSchema,
  scheduleTaskSchema,
  createSubtaskSchema,
  updateSubtaskSchema,
  reorderSubtasksSchema,
} from '../task'

/* ------------------------------------------------------------------ */
/*  helpers                                                           */
/* ------------------------------------------------------------------ */

function validTask() {
  return { title: 'Finish onboarding flow' }
}

const UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

/* ------------------------------------------------------------------ */
/*  createTaskSchema                                                  */
/* ------------------------------------------------------------------ */

describe('createTaskSchema', () => {
  /* --- happy path --- */

  it('accepts minimal valid input (title only)', () => {
    const result = createTaskSchema.safeParse(validTask())
    expect(result.success).toBe(true)
  })

  it('accepts full valid input with every optional field', () => {
    const result = createTaskSchema.safeParse({
      title: 'Build API layer',
      notes: 'Use tRPC',
      calendar_id: UUID,
      importance: 'high',
      time_estimate_minutes: 120,
      earliest_start: '2026-06-15',
      due_date: '2026-06-20',
      due_date_recurrence: 'RRULE:FREQ=WEEKLY',
      scheduled_start: '2026-06-15T09:00:00Z',
      scheduled_end: '2026-06-15T11:00:00Z',
      location: 'Home office',
      visibility: 'free',
      privacy: 'public',
      flexibility: 'not_flexible',
      status: 'in_progress',
      board: 'future',
      tag_ids: [UUID],
      reminders: [{ minutes_before: 30 }],
      subtasks: [{ title: 'Setup project', time_estimate_minutes: 15 }],
    })
    expect(result.success).toBe(true)
  })

  it('applies defaults for omitted optional fields', () => {
    const result = createTaskSchema.parse(validTask())
    expect(result.importance).toBe('normal')
    expect(result.visibility).toBe('busy')
    expect(result.privacy).toBe('private')
    expect(result.flexibility).toBe('flexible')
    expect(result.status).toBe('backlog')
    expect(result.board).toBe('current')
    expect(result.tag_ids).toEqual([])
    expect(result.reminders).toEqual([])
  })

  /* --- required fields --- */

  it('rejects missing title', () => {
    const result = createTaskSchema.safeParse({})
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })

  it('rejects empty title', () => {
    const result = createTaskSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })

  it('rejects title exceeding 500 characters', () => {
    const result = createTaskSchema.safeParse({ title: 'x'.repeat(501) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['title'])
  })

  /* --- notes --- */

  it('accepts null notes', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), notes: null })
    expect(result.success).toBe(true)
  })

  it('rejects notes exceeding 10000 characters', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), notes: 'n'.repeat(10001) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['notes'])
  })

  /* --- calendar_id --- */

  it('accepts null calendar_id', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), calendar_id: null })
    expect(result.success).toBe(true)
  })

  it('rejects non-uuid calendar_id', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), calendar_id: 'bad' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['calendar_id'])
  })

  /* --- importance enum --- */

  it.each(['lowest', 'low', 'normal', 'high', 'highest'] as const)(
    'accepts importance=%s',
    (importance) => {
      const result = createTaskSchema.safeParse({ ...validTask(), importance })
      expect(result.success).toBe(true)
    },
  )

  it('rejects invalid importance', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), importance: 'critical' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['importance'])
  })

  /* --- status enum --- */

  it.each(['backlog', 'in_progress', 'check', 'done'] as const)(
    'accepts status=%s',
    (status) => {
      const result = createTaskSchema.safeParse({ ...validTask(), status })
      expect(result.success).toBe(true)
    },
  )

  it('rejects invalid status', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), status: 'cancelled' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['status'])
  })

  /* --- board enum --- */

  it.each(['current', 'future'] as const)('accepts board=%s', (board) => {
    const result = createTaskSchema.safeParse({ ...validTask(), board })
    expect(result.success).toBe(true)
  })

  it('rejects invalid board', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), board: 'archive' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['board'])
  })

  /* --- flexibility enum --- */

  it.each(['flexible', 'not_flexible'] as const)('accepts flexibility=%s', (flexibility) => {
    const result = createTaskSchema.safeParse({ ...validTask(), flexibility })
    expect(result.success).toBe(true)
  })

  /* --- time_estimate_minutes --- */

  it('accepts positive integer time estimate', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), time_estimate_minutes: 30 })
    expect(result.success).toBe(true)
  })

  it('accepts null time estimate', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), time_estimate_minutes: null })
    expect(result.success).toBe(true)
  })

  it('rejects zero time estimate', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), time_estimate_minutes: 0 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['time_estimate_minutes'])
  })

  it('rejects negative time estimate', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), time_estimate_minutes: -10 })
    expect(result.success).toBe(false)
  })

  it('rejects fractional time estimate', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), time_estimate_minutes: 30.5 })
    expect(result.success).toBe(false)
  })

  /* --- date fields --- */

  it('accepts valid date string for earliest_start', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), earliest_start: '2026-06-15' })
    expect(result.success).toBe(true)
  })

  it('rejects datetime for earliest_start (expects date only)', () => {
    const result = createTaskSchema.safeParse({
      ...validTask(),
      earliest_start: '2026-06-15T09:00:00Z',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['earliest_start'])
  })

  it('accepts valid date string for due_date', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), due_date: '2026-06-20' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid date format for due_date', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), due_date: '06/20/2026' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['due_date'])
  })

  /* --- scheduled_start/end --- */

  it('accepts valid datetime for scheduled_start', () => {
    const result = createTaskSchema.safeParse({
      ...validTask(),
      scheduled_start: '2026-06-15T09:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects date-only string for scheduled_start', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), scheduled_start: '2026-06-15' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['scheduled_start'])
  })

  it('accepts null scheduled_start and scheduled_end', () => {
    const result = createTaskSchema.safeParse({
      ...validTask(),
      scheduled_start: null,
      scheduled_end: null,
    })
    expect(result.success).toBe(true)
  })

  /* --- tag_ids --- */

  it('enforces tag_ids max of 50', () => {
    const tag_ids = Array.from({ length: 51 }, () => UUID)
    const result = createTaskSchema.safeParse({ ...validTask(), tag_ids })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['tag_ids'])
  })

  it('accepts exactly 50 tag_ids', () => {
    const tag_ids = Array.from({ length: 50 }, () => UUID)
    const result = createTaskSchema.safeParse({ ...validTask(), tag_ids })
    expect(result.success).toBe(true)
  })

  it('rejects non-uuid tag_ids', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), tag_ids: ['not-a-uuid'] })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['tag_ids', 0])
  })

  /* --- subtasks --- */

  it('accepts valid subtasks array', () => {
    const result = createTaskSchema.safeParse({
      ...validTask(),
      subtasks: [{ title: 'Sub 1' }, { title: 'Sub 2', time_estimate_minutes: 10 }],
    })
    expect(result.success).toBe(true)
  })

  it('enforces subtasks max of 100', () => {
    const subtasks = Array.from({ length: 101 }, (_, i) => ({ title: `Sub ${i}` }))
    const result = createTaskSchema.safeParse({ ...validTask(), subtasks })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['subtasks'])
  })

  it('rejects subtask with empty title', () => {
    const result = createTaskSchema.safeParse({
      ...validTask(),
      subtasks: [{ title: '' }],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['subtasks', 0, 'title'])
  })

  /* --- reminders --- */

  it('enforces reminders max of 20', () => {
    const reminders = Array.from({ length: 21 }, () => ({ minutes_before: 5 }))
    const result = createTaskSchema.safeParse({ ...validTask(), reminders })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['reminders'])
  })

  /* --- location --- */

  it('rejects location exceeding 500 characters', () => {
    const result = createTaskSchema.safeParse({ ...validTask(), location: 'x'.repeat(501) })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['location'])
  })
})

/* ------------------------------------------------------------------ */
/*  updateTaskSchema                                                  */
/* ------------------------------------------------------------------ */

describe('updateTaskSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateTaskSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts partial update with title only', () => {
    const result = updateTaskSchema.safeParse({ title: 'Updated title' })
    expect(result.success).toBe(true)
  })

  it('still enforces field constraints when present', () => {
    const result = updateTaskSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  moveTaskSchema                                                    */
/* ------------------------------------------------------------------ */

describe('moveTaskSchema', () => {
  it('accepts valid status', () => {
    const result = moveTaskSchema.safeParse({ status: 'in_progress' })
    expect(result.success).toBe(true)
  })

  it('accepts status with board and position', () => {
    const result = moveTaskSchema.safeParse({ status: 'done', board: 'current', position: 3 })
    expect(result.success).toBe(true)
  })

  it('accepts a board-only move (status is optional now)', () => {
    const result = moveTaskSchema.safeParse({ board: 'future' })
    expect(result.success).toBe(true)
  })

  it('accepts a position-only move', () => {
    const result = moveTaskSchema.safeParse({ position: 2.5 })
    expect(result.success).toBe(true)
  })

  it('rejects an empty move with no fields', () => {
    const result = moveTaskSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects invalid status', () => {
    const result = moveTaskSchema.safeParse({ status: 'deleted' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid board', () => {
    const result = moveTaskSchema.safeParse({ status: 'backlog', board: 'archive' })
    expect(result.success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  splitTaskSchema                                                   */
/* ------------------------------------------------------------------ */

describe('splitTaskSchema', () => {
  it('accepts empty object (chunks optional)', () => {
    const result = splitTaskSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts chunks in valid range', () => {
    const result = splitTaskSchema.safeParse({ chunks: 5 })
    expect(result.success).toBe(true)
  })

  it('accepts minimum chunks (2)', () => {
    const result = splitTaskSchema.safeParse({ chunks: 2 })
    expect(result.success).toBe(true)
  })

  it('accepts maximum chunks (20)', () => {
    const result = splitTaskSchema.safeParse({ chunks: 20 })
    expect(result.success).toBe(true)
  })

  it('rejects chunks below minimum (1)', () => {
    const result = splitTaskSchema.safeParse({ chunks: 1 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['chunks'])
  })

  it('rejects chunks above maximum (21)', () => {
    const result = splitTaskSchema.safeParse({ chunks: 21 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['chunks'])
  })

  it('rejects fractional chunks', () => {
    const result = splitTaskSchema.safeParse({ chunks: 3.5 })
    expect(result.success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  scheduleTaskSchema                                                */
/* ------------------------------------------------------------------ */

describe('scheduleTaskSchema', () => {
  it('accepts valid datetime pair', () => {
    const result = scheduleTaskSchema.safeParse({
      scheduled_start: '2026-06-15T09:00:00Z',
      scheduled_end: '2026-06-15T11:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing scheduled_start', () => {
    const result = scheduleTaskSchema.safeParse({ scheduled_end: '2026-06-15T11:00:00Z' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['scheduled_start'])
  })

  it('rejects missing scheduled_end', () => {
    const result = scheduleTaskSchema.safeParse({ scheduled_start: '2026-06-15T09:00:00Z' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['scheduled_end'])
  })

  it('rejects non-datetime strings', () => {
    const result = scheduleTaskSchema.safeParse({
      scheduled_start: '2026-06-15',
      scheduled_end: '2026-06-15',
    })
    expect(result.success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  createSubtaskSchema                                               */
/* ------------------------------------------------------------------ */

describe('createSubtaskSchema', () => {
  it('accepts valid subtask with title only', () => {
    const result = createSubtaskSchema.safeParse({ title: 'Write tests' })
    expect(result.success).toBe(true)
  })

  it('accepts subtask with time estimate', () => {
    const result = createSubtaskSchema.safeParse({ title: 'Write tests', time_estimate_minutes: 45 })
    expect(result.success).toBe(true)
  })

  it('accepts null time_estimate_minutes', () => {
    const result = createSubtaskSchema.safeParse({
      title: 'Write tests',
      time_estimate_minutes: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing title', () => {
    const result = createSubtaskSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty title', () => {
    const result = createSubtaskSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })

  it('rejects title exceeding 500 characters', () => {
    const result = createSubtaskSchema.safeParse({ title: 'x'.repeat(501) })
    expect(result.success).toBe(false)
  })

  it('rejects zero time estimate', () => {
    const result = createSubtaskSchema.safeParse({ title: 'Sub', time_estimate_minutes: 0 })
    expect(result.success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  updateSubtaskSchema                                               */
/* ------------------------------------------------------------------ */

describe('updateSubtaskSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateSubtaskSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts title update', () => {
    const result = updateSubtaskSchema.safeParse({ title: 'Renamed' })
    expect(result.success).toBe(true)
  })

  it('accepts completed flag', () => {
    const result = updateSubtaskSchema.safeParse({ completed: true })
    expect(result.success).toBe(true)
  })

  it('rejects empty title when provided', () => {
    const result = updateSubtaskSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  reorderSubtasksSchema                                             */
/* ------------------------------------------------------------------ */

describe('reorderSubtasksSchema', () => {
  it('accepts valid uuid array', () => {
    const result = reorderSubtasksSchema.safeParse({ subtask_ids: [UUID] })
    expect(result.success).toBe(true)
  })

  it('rejects missing subtask_ids', () => {
    const result = reorderSubtasksSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects non-uuid strings', () => {
    const result = reorderSubtasksSchema.safeParse({ subtask_ids: ['bad-id'] })
    expect(result.success).toBe(false)
  })

  it('enforces max of 200', () => {
    const subtask_ids = Array.from({ length: 201 }, () => UUID)
    const result = reorderSubtasksSchema.safeParse({ subtask_ids })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['subtask_ids'])
  })
})

describe('vault_ref', () => {
  it.each(['work:mw-1a2b3c4d', 'a', 'A.b_c-d:e', 'x'.repeat(128)])('accepts %s', (ref) => {
    expect(createTaskSchema.safeParse({ ...validTask(), vault_ref: ref }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ vault_ref: ref }).success).toBe(true)
  })

  it.each(['', 'has space', 'x'.repeat(129), '../up', 'a/b', 'caf\u00e9', 'a\nb'])('rejects %j', (ref) => {
    expect(createTaskSchema.safeParse({ ...validTask(), vault_ref: ref }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ vault_ref: ref }).success).toBe(false)
  })

  it('is nullable and optional', () => {
    expect(createTaskSchema.parse({ ...validTask(), vault_ref: null }).vault_ref).toBeNull()
    expect(createTaskSchema.parse(validTask()).vault_ref).toBeUndefined()
    expect(updateTaskSchema.parse({ vault_ref: null })).toEqual({ vault_ref: null })
  })
})

describe('completed_at', () => {
  it('accepts a timestamp or null and rejects a bare date', () => {
    expect(createTaskSchema.safeParse({ ...validTask(), completed_at: '2026-04-16T12:00:00.000Z' }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ completed_at: null }).success).toBe(true)
    expect(updateTaskSchema.safeParse({ completed_at: '2026-04-16' }).success).toBe(false)
  })
})
