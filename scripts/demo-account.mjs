// The demo account that local setup creates: demo@meowlendar.com / meowlendar, with a sample
// week around today, so a new install has something to look at before you sign up.
//
// Local Supabase only. seedDemoAccount refuses any URL that isn't this machine, so the demo
// (and its public password) can never land on a hosted project.

export const DEMO_EMAIL = 'demo@meowlendar.com'
export const DEMO_PASSWORD = 'meowlendar'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** True only for a Supabase running on this machine. */
export function isLocalSupabaseUrl(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

const pad = (n) => String(n).padStart(2, '0')
const dateOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * The sample week, anchored to `today` in the machine's own time zone. The week runs Sunday to
 * Saturday, the app's default. Pure: rows reference calendars and tags by key ('work', 'launch'),
 * and the seeder swaps in real ids.
 */
export function buildDemoWeek(today = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
  const t = today.getDay() // today's index in the week
  /** An instant: `day` days after Sunday at a wall-clock time, in this machine's zone. */
  const at = (day, hm) => {
    const [h, m] = hm.split(':').map(Number)
    return new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + day, h, m).toISOString()
  }
  const day = (offset) => dateOf(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + offset))
  // All-day items store the calendar date at UTC midnight with an exclusive end, as Google does.
  const allDay = (offset) => ({ start_time: `${day(offset)}T00:00:00.000Z`, end_time: `${day(offset + 1)}T00:00:00.000Z`, is_all_day: true, visibility: 'free' })
  const timed = (offset, from, to) => ({ start_time: at(offset, from), end_time: at(offset, to), is_all_day: false })

  const calendars = [
    { key: 'my', name: 'My Calendar', color: '#e8930c' },
    { key: 'work', name: 'Work', color: '#5a68d4' },
    { key: 'personal', name: 'Personal', color: '#cf5d78' },
    { key: 'gym', name: 'Gym', color: '#2b93b4' },
  ]

  const tags = [
    { name: 'launch', color: '#e8930c' },
    { name: 'site', color: '#5a68d4' },
    { name: 'home', color: '#cf5d78' },
    { name: 'admin', color: '#8b7d69' },
  ]

  const events = [
    { calendar: 'personal', title: 'Brunch with Sam', ...timed(0, '10:00', '11:30'), location: 'Sunny Side Cafe' },
    { calendar: 'work', title: 'Standup', ...timed(1, '09:00', '09:30'), recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
    { calendar: 'work', title: 'Design review', ...timed(1, '11:00', '12:00') },
    { calendar: 'work', title: 'Client call', ...timed(2, '10:00', '11:30'), conferencing_url: 'https://meet.example.com/client-call' },
    // Two events at the same time, so the grid shows how it splits a slot.
    { calendar: 'work', title: '1:1 with Priya', ...timed(3, '14:00', '15:00') },
    { calendar: 'work', title: 'Quick sync', ...timed(3, '14:30', '15:00') },
    { calendar: 'personal', title: 'Pottery class', ...timed(3, '19:30', '21:00') },
    { calendar: 'work', title: 'Roadmap sync', ...timed(t, '10:00', '11:00') },
    { calendar: 'personal', title: 'Lunch with Dev', ...timed(t, '12:30', '13:15') },
    { calendar: 'personal', title: "Vet: Miso's checkup", ...timed(t, '16:00', '16:45'), location: 'Northside Vet' },
    { calendar: 'work', title: 'Interview: frontend', ...timed(t + 1, '11:00', '12:00'), conferencing_url: 'https://meet.example.com/interview' },
    { calendar: 'personal', title: 'Drinks', ...timed(5, '17:30', '19:00') },
    { calendar: 'personal', title: 'Farmers market', ...timed(6, '09:00', '10:30') },
    { calendar: 'my', title: 'Miso turns 4', ...allDay(5) },
  ].map((e) => ({ timezone: timeZone, ...e }))

  const routines = [
    { calendar: 'gym', title: 'Gym', start_time: '18:00', end_time: '19:00', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', timezone: timeZone },
    { calendar: 'my', title: 'Feed Miso', start_time: '08:00', end_time: '08:15', recurrence_rule: 'FREQ=DAILY', timezone: timeZone },
  ]

  // Every importance and every column, tags and subtasks, and two tasks "By your agent": scheduled
  // through the API, today and tomorrow.
  const tasks = [
    { title: 'Record the setup video', status: 'backlog', importance: 'normal', due_date: day(t + 4), time_estimate_minutes: 45, tags: ['launch'] },
    { title: 'Point meowlendar.com at the deploy', status: 'backlog', importance: 'high', due_date: day(t + 2), time_estimate_minutes: 30, tags: ['site'] },
    { title: 'Buy cat litter', status: 'backlog', importance: 'low', time_estimate_minutes: 15, tags: ['home'] },
    { title: 'Clear out old branches', status: 'backlog', importance: 'lowest', tags: ['site'] },
    {
      title: 'Write the launch post', status: 'in_progress', importance: 'high', due_date: day(t), time_estimate_minutes: 90, tags: ['launch'],
      scheduled_start: at(t, '14:00'), scheduled_end: at(t, '15:30'), created_via: 'api',
      notes: 'Scheduled by your agent through the API.', subtasks: [['Outline', true], ['First draft', false], ['Screenshots', false]],
    },
    {
      title: 'Ship booking page fix', status: 'in_progress', importance: 'highest', due_date: day(t + 1), time_estimate_minutes: 60, tags: ['site'],
      scheduled_start: at(t + 1, '15:00'), scheduled_end: at(t + 1, '16:00'), created_via: 'api',
      subtasks: [['Reproduce', true], ['Fix the slot math', true], ['Test on a phone', false]],
    },
    { title: 'Review MCP tool docs', status: 'check', importance: 'normal', time_estimate_minutes: 30, tags: ['launch'], subtasks: [['Tasks', true], ['Events', true], ['Routines', true], ['Booking', true]] },
    { title: 'Test Google two way sync', status: 'check', importance: 'high', due_date: day(t - 1), tags: ['site'] },
    { title: 'Rotate API key', status: 'done', importance: 'normal', tags: ['admin'] },
    { title: "File last month's invoices", status: 'done', importance: 'normal', tags: ['admin'] },
    { title: 'Set up local calendar', status: 'done', importance: 'low', tags: ['site'] },
    { title: 'Telegram reminders', status: 'backlog', importance: 'normal', board: 'future', tags: ['launch'] },
    { title: 'Publish the MCP to npm', status: 'backlog', importance: 'high', board: 'future', tags: ['launch'] },
  ].map((task, i) => ({
    board: 'current',
    position: (i + 1) * 1000,
    completed_at: task.status === 'done' ? at(t, '09:00') : null,
    ...task,
  }))

  const bookingLink = {
    slug: 'intro-call',
    name: 'Intro call',
    duration_minutes: 30,
    timezone: timeZone,
    is_public: true,
    conferencing: true,
    availability: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => ({ day: d, start: '09:00', end: '17:00' })),
  }

  return { timeZone, calendars, tags, events, routines, tasks, bookingLink }
}

/**
 * Creates the demo user and its week. Idempotent: leaves an existing demo account alone unless
 * `reset` is set, which deletes it (everything it owns goes with it) and seeds a fresh one.
 * Returns 'created', 'exists' or 'reset'.
 */
export async function seedDemoAccount({ url, anonKey, serviceRoleKey, reset = false, createClient, today = new Date() }) {
  if (!isLocalSupabaseUrl(url)) {
    throw new Error('The demo account is only for a local Supabase (127.0.0.1 or localhost).')
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(url, serviceRoleKey, options)

  const existing = await findUser(admin, DEMO_EMAIL)
  if (existing && !reset) return 'exists'
  if (existing) {
    const { error } = await admin.auth.admin.deleteUser(existing.id)
    if (error) throw new Error(`could not remove the old demo account: ${error.message}`)
  }
  const { error: createError } = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true })
  if (createError) throw new Error(`could not create the demo account: ${createError.message}`)

  // Write the week as the demo user, under the same row-level security as the app.
  const db = createClient(url, anonKey, options)
  const { data: session, error: signInError } = await db.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
  if (signInError || !session.user) throw new Error(`could not sign in as the demo account: ${signInError?.message ?? 'no user'}`)
  await writeWeek(db, session.user.id, buildDemoWeek(today))
  return existing ? 'reset' : 'created'
}

async function findUser(admin, email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`could not list users: ${error.message}`)
    const hit = data.users.find((u) => u.email === email)
    if (hit || data.users.length < 200) return hit ?? null
  }
}

function must(label) {
  return ({ data, error }) => {
    if (error) throw new Error(`demo ${label}: ${error.message}`)
    return data
  }
}

async function writeWeek(db, userId, week) {
  // The sign-up trigger already made "My Calendar"; colour it and add the other three.
  const [mine] = must('calendar')(await db.from('calendars').select('id').eq('user_id', userId).eq('source', 'local').limit(1))
  must('calendar colour')(await db.from('calendars').update({ color: week.calendars[0].color, is_primary: true }).eq('id', mine.id))
  const added = must('calendars')(await db.from('calendars')
    .insert(week.calendars.slice(1).map(({ name, color }) => ({ user_id: userId, name, color, source: 'local' })))
    .select('id, name'))
  const calendarId = { my: mine.id }
  for (const c of week.calendars.slice(1)) calendarId[c.key] = added.find((a) => a.name === c.name).id

  const profile = must('profile')(await db.from('profiles').select('settings').eq('id', userId).single())
  must('profile settings')(await db.from('profiles').update({ settings: { ...(profile.settings ?? {}), timezone: week.timeZone } }).eq('id', userId))

  const tagRows = must('tags')(await db.from('tags').insert(week.tags.map((t) => ({ ...t, user_id: userId }))).select('id, name'))
  const tagId = Object.fromEntries(tagRows.map((t) => [t.name, t.id]))

  must('events')(await db.from('events').insert(week.events.map(({ calendar, ...e }) => ({ ...e, user_id: userId, calendar_id: calendarId[calendar] }))))
  must('routines')(await db.from('routines').insert(week.routines.map(({ calendar, ...r }) => ({ ...r, user_id: userId, calendar_id: calendarId[calendar] }))))

  const taskRows = week.tasks.map(({ tags: _tags, subtasks: _subtasks, ...task }) => ({ ...task, user_id: userId, calendar_id: calendarId.my }))
  let insert = await db.from('tasks').insert(taskRows).select('id, title')
  if (insert.error && /created_via/.test(insert.error.message)) {
    // A stack started before migration 042 has no created_via yet: seed without it.
    console.log('note  run "supabase migration up" to see "By your agent" on the demo tasks')
    insert = await db.from('tasks').insert(taskRows.map(({ created_via: _origin, ...task }) => task)).select('id, title')
  }
  const tasks = must('tasks')(insert)
  const taskId = Object.fromEntries(tasks.map((t) => [t.title, t.id]))

  const subtasks = week.tasks.flatMap((task) => (task.subtasks ?? []).map(([title, completed], i) => ({ task_id: taskId[task.title], title, completed, position: i + 1 })))
  if (subtasks.length) must('subtasks')(await db.from('subtasks').insert(subtasks))
  const links = week.tasks.flatMap((task) => (task.tags ?? []).map((name) => ({ task_id: taskId[task.title], tag_id: tagId[name] })))
  if (links.length) must('task tags')(await db.from('task_tags').insert(links))

  must('booking link')(await db.from('booking_links').insert({ ...week.bookingLink, user_id: userId }))
}
