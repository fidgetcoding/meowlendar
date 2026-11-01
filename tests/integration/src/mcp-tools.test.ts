import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { APP, createUser, type TestUser } from './helpers'

// Every MCP tool, over stdio, against the running app and a real database. The last
// test fails if a tool exists that nothing here called.

const MCP = process.env.MEOW_MCP_ENTRY as string
const VAULT_CLI = MCP.replace('index.js', 'vault-cli.js')
const DAY = '2030-01-08'
const AT = (time: string, day = DAY) => `${day}T${time}:00.000Z`
const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
  day,
  start: '09:00',
  end: '17:00',
}))

describe('every MCP tool against the real stack', () => {
  let client: Client
  let user: TestUser
  let allTools: string[] = []
  let root: string
  const called = new Set<string>()

  async function raw(name: string, args: Record<string, unknown> = {}) {
    called.add(name)
    const result = await client.callTool({ name, arguments: args })
    return { isError: Boolean(result.isError), text: (result.content as { text: string }[])[0]!.text }
  }

  /** Calls a tool that must succeed, and parses its answer. */
  async function ok<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { isError, text } = await raw(name, args)
    if (isError) throw new Error(`${name} failed: ${text}`)
    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }

  const items = <T>(body: unknown): T[] => {
    const value = body as { items?: T[] }
    return Array.isArray(body) ? (body as T[]) : (value.items ?? [])
  }

  beforeAll(async () => {
    user = await createUser('mcp')
    root = realpathSync(mkdtempSync(join(tmpdir(), 'meow-mcp-tools-')))
    client = new Client({ name: 'tool-coverage', version: '1' })
    await client.connect(
      new StdioClientTransport({
        command: 'node',
        args: [MCP],
        env: {
          ...process.env,
          MEOWLENDAR_API_KEY: user.apiKey,
          MEOWLENDAR_API_URL: APP,
          MEOWLENDAR_CONFIG_DIR: join(root, 'config'),
        } as Record<string, string>,
      }),
    )
    allTools = (await client.listTools()).tools.map((t) => t.name)
  })

  afterAll(async () => {
    await client.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('calendars', async () => {
    const before = await ok<{ local_calendars: { id: string }[] }>('list_calendars')
    expect(before.local_calendars).toHaveLength(1)
    const created = await ok<{ id: string; name: string }>('create_calendar', { name: 'Second', color: '#112233' })
    expect(created.name).toBe('Second')
  })

  it('events, including recurring ones', async () => {
    const { local_calendars } = await ok<{ local_calendars: { id: string }[] }>('list_calendars')
    const calendarId = local_calendars[0]!.id

    const event = await ok<{ id: string; title: string }>('create_event', {
      calendar_id: calendarId,
      title: 'Meeting',
      start_time: AT('10:00'),
      end_time: AT('11:00'),
      timezone: 'UTC',
      attendees: [{ email: user.email }],
      reminders: [{ minutes_before: 10 }],
    })
    expect((await ok<{ title: string }>('get_event', { id: event.id })).title).toBe('Meeting')
    expect((await ok<{ title: string }>('update_event', { id: event.id, title: 'Renamed' })).title).toBe('Renamed')

    const rsvp = await ok<{ attendees: { response_status?: string; response?: string }[] }>('rsvp_event', { event_id: event.id, response: 'accepted' })
    expect(JSON.stringify(rsvp)).toContain('accepted')

    const listed = items<{ title: string }>(await ok('list_events', { start: AT('00:00'), end: AT('23:59') }))
    expect(listed.map((e) => e.title)).toContain('Renamed')

    const series = await ok<{ id: string }>('create_event', {
      calendar_id: calendarId,
      title: 'Daily',
      start_time: AT('08:00', '2030-01-07'),
      end_time: AT('08:30', '2030-01-07'),
      timezone: 'UTC',
      recurrence_rule: 'FREQ=DAILY;COUNT=5',
    })
    await ok('update_event', { id: series.id, scope: 'single', occurrence_start: AT('08:00', '2030-01-09'), title: 'Moved' })
    await ok('delete_event', { id: series.id, scope: 'single', occurrence_start: AT('08:00', '2030-01-10') })
    const week = items<{ title: string }>(await ok('list_events', { start: AT('00:00', '2030-01-07'), end: AT('23:59', '2030-01-12') }))
    expect(week.filter((e) => e.title === 'Daily')).toHaveLength(3)
    expect(week.filter((e) => e.title === 'Moved')).toHaveLength(1)

    await ok('delete_event', { id: event.id })
    await expect(ok('get_event', { id: event.id })).rejects.toThrow()
  })

  it('tasks', async () => {
    const task = await ok<{ id: string; status: string }>('create_task', { title: 'A task', importance: 'high' })
    expect((await ok<{ title: string }>('get_task', { id: task.id })).title).toBe('A task')
    expect((await ok<{ notes: string }>('update_task', { id: task.id, notes: 'Some notes' })).notes).toBe('Some notes')
    expect(items<{ id: string }>(await ok('list_tasks', { status: 'backlog' })).map((t) => t.id)).toContain(task.id)
    expect((await ok<{ status: string }>('move_task', { id: task.id, status: 'in_progress' })).status).toBe('in_progress')

    const scheduled = await ok<{ scheduled_start: string }>('schedule_task', {
      id: task.id,
      scheduled_start: AT('13:00'),
      scheduled_end: AT('14:00'),
    })
    expect(new Date(scheduled.scheduled_start).toISOString()).toBe(AT('13:00'))

    const grid = items<{ id: string; kind: string }>(await ok('list_events', { start: AT('00:00'), end: AT('23:59') }))
    expect(grid.find((i) => i.id === task.id)?.kind).toBe('task')

    expect((await ok<{ status: string }>('close_task', { id: task.id })).status).toBe('done')
    expect((await ok<{ status: string }>('reopen_task', { id: task.id })).status).not.toBe('done')

    const other = await ok<{ id: string }>('create_task', {
      title: 'Overlaps',
      scheduled_start: AT('13:30'),
      scheduled_end: AT('14:30'),
    })
    const reflowed = await ok<{ date: string }>('reflow_day', { date: DAY, timezone: 'UTC' })
    expect(reflowed.date).toBe(DAY)

    const long = await ok<{ id: string }>('create_task', { title: 'Long job', time_estimate_minutes: 120 })
    const split = await ok<{ children: unknown[] }>('split_task', { id: long.id, chunks: 2 })
    expect(split.children).toHaveLength(2)

    await ok('delete_task', { id: other.id })
    await expect(ok('get_task', { id: other.id })).rejects.toThrow()
  })

  it('subtasks', async () => {
    const task = await ok<{ id: string }>('create_task', { title: 'Has subtasks' })
    const first = await ok<{ id: string }>('create_subtask', { task_id: task.id, title: 'First' })
    const second = await ok<{ id: string }>('create_subtask', { task_id: task.id, title: 'Second', time_estimate_minutes: 15 })
    expect(await ok<unknown[]>('list_subtasks', { task_id: task.id })).toHaveLength(2)
    expect((await ok<{ title: string }>('update_subtask', { task_id: task.id, subtask_id: first.id, title: 'Renamed' })).title).toBe('Renamed')
    const reordered = await ok<{ id: string }[]>('reorder_subtasks', { task_id: task.id, order: [second.id, first.id] })
    expect(reordered[0]!.id).toBe(second.id)
    expect((await ok<{ completed: boolean }>('complete_subtask', { task_id: task.id, subtask_id: first.id, completed: true })).completed).toBe(true)
    await ok('delete_subtask', { task_id: task.id, subtask_id: second.id })
    expect(await ok<unknown[]>('list_subtasks', { task_id: task.id })).toHaveLength(1)
  })

  it('bulk task operations', async () => {
    const created = await ok<{ success: boolean; data: { id: string } }[]>('bulk_create_tasks', {
      tasks: [{ title: 'Bulk one' }, { title: 'Bulk two', importance: 'low' }],
    })
    expect(created.every((r) => r.success)).toBe(true)
    const rows = created.map((r) => r.data)
    expect(rows).toHaveLength(2)
    const updated = await ok<{ success: boolean }[]>('bulk_update_tasks', { tasks: rows.map((t) => ({ id: t.id, notes: 'bulk note' })) })
    expect(updated.every((r) => r.success)).toBe(true)
    expect((await ok<{ notes: string }>('get_task', { id: rows[0]!.id })).notes).toBe('bulk note')
    await ok('bulk_delete_tasks', { ids: rows.map((t) => t.id) })
    await expect(ok('get_task', { id: rows[0]!.id })).rejects.toThrow()
  })

  it('routines', async () => {
    const routine = await ok<{ id: string }>('create_routine', {
      title: 'Stretch',
      start_time: '07:00',
      end_time: '07:15',
      timezone: 'UTC',
      recurrence_rule: 'FREQ=DAILY',
      reminders: [{ minutes_before: 5 }],
    })
    expect((await ok<{ title: string }>('get_routine', { id: routine.id })).title).toBe('Stretch')
    expect(items<{ id: string }>(await ok('list_routines')).map((r) => r.id)).toContain(routine.id)
    expect((await ok<{ title: string }>('update_routine', { id: routine.id, title: 'Long stretch' })).title).toBe('Long stretch')
    expect(JSON.stringify(await ok('complete_routine_instance', { routine_id: routine.id, date: DAY }))).toContain('completed')
    expect(JSON.stringify(await ok('skip_routine_instance', { routine_id: routine.id, date: '2030-01-09' }))).toContain('skipped')

    const grid = items<{ kind: string; routine_id?: string }>(await ok('list_events', { start: AT('00:00'), end: AT('23:59', '2030-01-09') }))
    expect(grid.filter((i) => i.kind === 'routine_instance' && i.routine_id === routine.id).length).toBeGreaterThan(0)

    await ok('delete_routine', { id: routine.id })
    await expect(ok('get_routine', { id: routine.id })).rejects.toThrow()
  })

  it('tags', async () => {
    const tag = await ok<{ id: string }>('create_tag', { name: 'Urgent', color: '#ff0000', prefix: '01' })
    expect((await ok<{ name: string }>('get_tag', { id: tag.id })).name).toBe('Urgent')
    expect(items<{ id: string }>(await ok('list_tags')).map((t) => t.id)).toContain(tag.id)
    expect((await ok<{ name: string }>('update_tag', { id: tag.id, name: 'Later' })).name).toBe('Later')
    await ok('delete_tag', { id: tag.id })
    await expect(ok('get_tag', { id: tag.id })).rejects.toThrow()
  })

  it('booking links and bookings', async () => {
    const link = await ok<{ id: string; slug: string }>('create_booking_link', {
      slug: `mcp-${Date.now().toString(36)}`,
      name: 'Intro call',
      duration_minutes: 30,
      availability: ALL_DAYS,
      timezone: 'UTC',
      conferencing: false,
    })
    expect((await ok<{ name: string }>('get_booking_link', { id: link.id })).name).toBe('Intro call')
    expect(items<{ id: string }>(await ok('list_booking_links')).map((l) => l.id)).toContain(link.id)
    expect((await ok<{ name: string }>('update_booking_link', { id: link.id, name: 'Quick call' })).name).toBe('Quick call')

    const slots = await ok<{ start: string }[]>('get_availability', { booking_link_id: link.id, date: DAY, timezone: 'UTC' })
    expect(slots.length).toBeGreaterThan(0)

    const booked = await ok<{ status: string }>('book_slot', {
      booking_link_id: link.id,
      name: 'A Guest',
      email: 'guest@example.com',
      start_time: slots[0]!.start,
      notes: 'Looking forward to it',
    })
    expect(booked.status).toBe('confirmed')
    const bookings = items<{ booker_email: string }>(await ok('list_bookings', { booking_link_id: link.id }))
    expect(bookings.map((b) => b.booker_email)).toEqual(['guest@example.com'])

    await ok('delete_booking_link', { id: link.id })
    await expect(ok('get_booking_link', { id: link.id })).rejects.toThrow()
  })

  it('schedules', async () => {
    const schedule = await ok<{ id: string }>('create_schedule', {
      name: 'Working hours',
      time_blocks: [{ day: 'monday', start: '09:00', end: '17:00' }],
    })
    expect((await ok<{ name: string }>('get_schedule', { id: schedule.id })).name).toBe('Working hours')
    expect(items<{ id: string }>(await ok('list_schedules')).map((s) => s.id)).toContain(schedule.id)
    expect((await ok<{ name: string }>('update_schedule', { id: schedule.id, name: 'Core hours' })).name).toBe('Core hours')
    await ok('delete_schedule', { id: schedule.id })
    await expect(ok('get_schedule', { id: schedule.id })).rejects.toThrow()
  })

  it('search and convert', async () => {
    const task = await ok<{ id: string }>('create_task', {
      title: 'Findable zebra',
      scheduled_start: AT('15:00'),
      scheduled_end: AT('16:00'),
    })
    const found = items<{ id: string }>(await ok('search', { query: 'zebra' }))
    expect(found.map((r) => r.id)).toContain(task.id)

    const { local_calendars } = await ok<{ local_calendars: { id: string }[] }>('list_calendars')
    const converted = await ok<{ type?: string; data?: { title: string }; title?: string }>('convert_item', {
      source_type: 'task',
      source_id: task.id,
      target_type: 'event',
      calendar_id: local_calendars[0]!.id,
    })
    expect(JSON.stringify(converted)).toContain('Findable zebra')
    await expect(ok('get_task', { id: task.id })).rejects.toThrow()
  })

  it('profile', async () => {
    expect((await ok<{ id: string }>('get_profile')).id).toBe(user.id)
    expect((await ok<{ display_name: string }>('update_profile', { display_name: 'Renamed Person' })).display_name).toBe('Renamed Person')
  })

  it('API keys', async () => {
    const created = await ok<{ id: string; key: string }>('create_api_key', { name: 'Another' })
    expect(created.key).toMatch(/^pk_/)
    expect(await ok<{ id: string }[]>('list_api_keys')).toHaveLength(2)
    await ok('delete_api_key', { id: created.id })
    expect(await ok<{ id: string }[]>('list_api_keys')).toHaveLength(1)
  })

  it('the vault tools, on a temp vault', async () => {
    const vault = join(root, 'vault')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    mkdirSync(join(vault, 'Tasks'))
    writeFileSync(join(vault, 'Tasks', 'todo.md'), '- [ ] From a note\n')
    await promisify(execFile)('node', [VAULT_CLI, 'connect', '--name', 'temp', '--vault', vault, '--folder', 'Tasks'], {
      env: { ...process.env, MEOWLENDAR_CONFIG_DIR: join(root, 'config') },
    })
    expect(JSON.stringify(await ok('vault_list'))).toContain('temp')
    const plan = await ok<{ planId: string; empty: boolean }>('vault_plan', { name: 'temp' })
    expect(plan.empty).toBe(false)
    await ok('vault_apply', { name: 'temp', plan_id: plan.planId })
  })

  it('refuses arguments a tool does not declare', async () => {
    const task = await ok<{ id: string }>('create_task', { title: 'Guarded' })
    const injected = await raw('update_task', { id: task.id, vault_ref: 'evil:line' })
    expect(injected.isError).toBe(true)
    expect(injected.text).toContain('vault_ref')
    const stored = await ok<{ vault_ref: string | null }>('get_task', { id: task.id })
    expect(stored.vault_ref).toBeNull()
  })

  it('refuses a traversal id', async () => {
    const { isError } = await raw('delete_task', { id: '../api-keys/abc' })
    expect(isError).toBe(true)
  })

  it('called every tool', () => {
    expect(allTools.length).toBeGreaterThanOrEqual(63)
    expect(allTools.filter((name) => !called.has(name))).toEqual([])
  })
})
