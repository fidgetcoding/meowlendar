import { createECDH, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { APP, browserApi, createUser, cron, fakes, serviceClient, type TestUser } from './helpers'

// Email, Telegram and push go to local fake servers here, not to Resend, Telegram or
// any browser's push service. These show the app sends the right thing to the right
// place. They don't prove delivery by the real services.

interface Recorded {
  telegram: { token: string; chat_id: string; text: string }[]
  resend: { to: string | string[]; from: string; subject: string; html: string; attachments?: { filename: string; content: string }[] }[]
  push: { url: string; authorization: string | null; encoding: string | null; bytes: number }[]
}

const recorded = () => fakes<Recorded>('recorded')

const ON = { enabled: true, reminders: true, due_dates: true, bookings: true, schedule_changes: true }
const OFF = { enabled: false, reminders: false, due_dates: false, bookings: false, schedule_changes: false }

async function setChannels(user: TestUser, channels: Record<string, unknown>) {
  const { data } = await user.client.from('profiles').select('settings').eq('id', user.id).single()
  const { error } = await user.client
    .from('profiles')
    .update({ settings: { ...data!.settings, notifications: { browser_push: OFF, email: OFF, in_app: OFF, telegram: OFF, ...channels } } })
    .eq('id', user.id)
  expect(error).toBeNull()
}

function pushSubscription(path: string) {
  const client = createECDH('prime256v1')
  client.generateKeys()
  return {
    endpoint: `https://127.0.0.1:4104/${path}`,
    keys: {
      p256dh: client.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  }
}

async function localCalendar(user: TestUser): Promise<string> {
  const body = (await (await user.api('/api/calendars')).json()) as { local_calendars: { id: string }[] }
  return body.local_calendars[0]!.id
}

const ALL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
  day,
  start: '00:00',
  end: '23:59',
}))

async function bookingLink(user: TestUser, extra: Record<string, unknown> = {}) {
  const slug = `note-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`
  const { error } = await user.client.from('booking_links').insert({
    user_id: user.id,
    slug,
    name: 'Intro',
    duration_minutes: 30,
    availability: ALL_DAYS,
    timezone: 'UTC',
    conferencing: false,
    is_public: true,
    ...extra,
  })
  expect(error).toBeNull()
  return slug
}

const nextSlot = (hour = 10) => {
  const d = new Date(Date.now() + 3 * 864e5)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

const book = (slug: string, email: string, start = nextSlot()) =>
  fetch(`${APP}/api/booking/book/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ booker_name: 'A Guest', booker_email: email, start_time: start }),
  })

describe('email through a fake Resend', () => {
  beforeEach(() => fakes('reset'))

  it('sends the booker a confirmation with a calendar invite', async () => {
    const host = await createUser('mail-a')
    const slug = await bookingLink(host)
    const res = await book(slug, 'guest-a@example.com')
    expect(res.status).toBe(201)

    const { resend } = await recorded()
    const mail = resend.find((m) => JSON.stringify(m.to).includes('guest-a@example.com'))!
    expect(mail.from).toContain('noreply@example.test')
    expect(mail.subject).toContain('Intro')
    const invite = Buffer.from(mail.attachments![0]!.content, 'base64').toString()
    expect(invite).toContain('BEGIN:VCALENDAR')
    expect(invite).toContain('guest-a@example.com')
  })

  it('emails the host when their email channel is on', async () => {
    const host = await createUser('mail-b')
    await setChannels(host, { email: ON })
    const slug = await bookingLink(host)
    await book(slug, 'guest-b@example.com')
    const { resend } = await recorded()
    expect(resend.some((m) => JSON.stringify(m.to).includes(host.email))).toBe(true)
  })

  it('sends a test email from settings', async () => {
    const user = await createUser('mail-c')
    await setChannels(user, { email: ON })
    const res = await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'email' }) })
    expect(res.status).toBe(200)
    expect(JSON.stringify((await recorded()).resend)).toContain('Test Notification')
  })

  it('escapes a hostile name in the invite', async () => {
    const host = await createUser('mail-d')
    const slug = await bookingLink(host)
    const res = await fetch(`${APP}/api/booking/book/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booker_name: '<script>alert(1)</script>', booker_email: 'guest-d@example.com', start_time: nextSlot() }),
    })
    expect(res.status).toBe(201)
    const { resend } = await recorded()
    expect(JSON.stringify(resend)).not.toContain('<script>alert(1)')
  })
})

describe('push alerts through a fake push service', () => {
  beforeEach(() => fakes('reset'))

  it('sends an encrypted, signed message', async () => {
    const user = await createUser('push-a')
    const sub = await user.api('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify(pushSubscription('sub-a')) })
    expect(sub.status).toBeLessThan(300)

    const res = await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'browser_push' }) })
    expect(res.status).toBe(200)

    const { push } = await recorded()
    expect(push).toHaveLength(1)
    expect(push[0]!.url).toBe('/sub-a')
    expect(push[0]!.encoding).toBe('aes128gcm')
    expect(push[0]!.authorization).toMatch(/^vapid t=/)
    expect(push[0]!.bytes).toBeGreaterThan(80)
  })

  it('removes a subscription the push service says has gone', async () => {
    const user = await createUser('push-b')
    await user.api('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify(pushSubscription('sub-b')) })
    await fakes('push-status', { status: 410 })
    await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'browser_push' }) })
    const { data } = await serviceClient().from('push_subscriptions').select('id').eq('user_id', user.id)
    expect(data).toEqual([])
  })

  it('refuses an address that is not a push service', async () => {
    const user = await createUser('push-c')
    for (const endpoint of ['http://127.0.0.1:4104/x', 'https://169.254.169.254/latest/meta-data', 'https://evil.example.com/hook']) {
      const res = await user.api('/api/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({ ...pushSubscription('x'), endpoint }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }
    const { data } = await serviceClient().from('push_subscriptions').select('id').eq('user_id', user.id)
    expect(data).toEqual([])
  })

  it('keeps one user out of another user\'s subscriptions', async () => {
    const a = await createUser('push-d')
    await a.api('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify(pushSubscription('sub-d')) })
    const b = await createUser('push-e')
    const { data } = await b.client.from('push_subscriptions').select('id').eq('user_id', a.id)
    expect(data).toEqual([])
  })
})

describe('reminders', () => {
  beforeEach(() => fakes('reset'))

  async function telegramOn(user: TestUser) {
    await setChannels(user, { telegram: ON })
    const { data } = await user.client.from('profiles').select('settings').eq('id', user.id).single()
    await user.client.from('profiles').update({ settings: { ...data!.settings, telegram_chat_id: '42' } }).eq('id', user.id)
    const res = await browserApi(user, '/api/telegram/token', {
      method: 'PUT',
      body: JSON.stringify({ token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ' }),
    })
    expect(res.status).toBe(200)
  }

  /** A start time whose 10-minute reminder falls due within the next minute. */
  const dueSoon = () => new Date(Date.now() + 10 * 60_000 + 20_000)

  it('fires once for an event, even when the job runs twice', async () => {
    const user = await createUser('rem-a')
    await telegramOn(user)
    const start = dueSoon()
    const created = await user.api('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        calendar_id: await localCalendar(user),
        title: 'Soon event',
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + 1_800_000).toISOString(),
        timezone: 'UTC',
        reminders: [{ minutes_before: 10 }],
      }),
    })
    expect(created.status).toBe(201)

    expect((await cron('reminders')).status).toBe(200)
    expect((await cron('reminders')).status).toBe(200)
    const { telegram } = await recorded()
    expect(telegram.filter((m) => m.text.includes('Soon event'))).toHaveLength(1)
  })

  it('fires for a later occurrence of a recurring event', async () => {
    const user = await createUser('rem-b')
    await telegramOn(user)
    const start = dueSoon()
    const firstDay = new Date(start.getTime() - 3 * 864e5)
    const res = await user.api('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        calendar_id: await localCalendar(user),
        title: 'Daily soon',
        start_time: firstDay.toISOString(),
        end_time: new Date(firstDay.getTime() + 1_800_000).toISOString(),
        timezone: 'UTC',
        recurrence_rule: 'FREQ=DAILY',
        reminders: [{ minutes_before: 10 }],
      }),
    })
    expect(res.status).toBe(201)
    await cron('reminders')
    expect((await recorded()).telegram.some((m) => m.text.includes('Daily soon'))).toBe(true)
  })

  it('fires for a scheduled task', async () => {
    const user = await createUser('rem-c')
    await telegramOn(user)
    const start = dueSoon()
    await user.api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Soon task',
        scheduled_start: start.toISOString(),
        scheduled_end: new Date(start.getTime() + 1_800_000).toISOString(),
        reminders: [{ minutes_before: 10 }],
      }),
    })
    await cron('reminders')
    expect((await recorded()).telegram.some((m) => m.text.includes('Soon task'))).toBe(true)
  })

  describe('routines', () => {
    async function routineDueSoon(user: TestUser, title: string, timezone: string) {
      const start = dueSoon()
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
        // Times are whole minutes, so aim for the minute that keeps the reminder in window.
        new Date(start.getTime() + 30_000),
      )
      const later = new Date(start.getTime() + 60 * 60_000)
      const end = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(later)
      const res = await user.api('/api/routines', {
        method: 'POST',
        body: JSON.stringify({
          title,
          start_time: hm,
          end_time: end,
          timezone,
          recurrence_rule: 'FREQ=DAILY',
          reminders: [{ minutes_before: 10 }],
        }),
      })
      expect(res.status).toBe(201)
      return (await res.json()) as { id: string }
    }

    /** Whole-minute start times can miss the window by a few seconds, so allow a retry. */
    async function fired(title: string) {
      for (let i = 0; i < 3; i++) {
        await cron('reminders')
        if ((await recorded()).telegram.some((m) => m.text.includes(title))) return true
        await new Promise((r) => setTimeout(r, 25_000))
      }
      return false
    }

    it('reminds with no instance row, in the routine\'s own time zone', async () => {
      const user = await createUser('rem-d')
      await telegramOn(user)
      await routineDueSoon(user, 'Stretch in Dubai', 'Asia/Dubai')
      expect(await fired('Stretch in Dubai')).toBe(true)
    }, 120_000)

    it('stays quiet on a day marked skipped', async () => {
      const user = await createUser('rem-e')
      await telegramOn(user)
      const routine = await routineDueSoon(user, 'Skipped stretch', 'UTC')
      const today = new Date().toISOString().slice(0, 10)
      const skip = await user.api(`/api/routines/${routine.id}/instances/${today}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped' }),
      })
      expect(skip.status).toBe(200)
      await cron('reminders')
      expect((await recorded()).telegram.some((m) => m.text.includes('Skipped stretch'))).toBe(false)
    })

    it('tracks completing and skipping across a window', async () => {
      const user = await createUser('rem-f')
      const created = await user.api('/api/routines', {
        method: 'POST',
        body: JSON.stringify({ title: 'Weekly', start_time: '09:00', end_time: '09:30', timezone: 'UTC', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE' }),
      })
      const routine = (await created.json()) as { id: string }
      const done = await user.api(`/api/routines/${routine.id}/instances/2030-01-07`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
      expect(done.status).toBe(200)

      const res = await user.api(`/api/routines/${routine.id}/instances?start=2030-01-07&end=2030-01-13`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { date: string; status: string }[] | { items: { date: string; status: string }[] }
      const rows = Array.isArray(body) ? body : body.items
      expect(rows.map((r) => r.date).sort()).toEqual(['2030-01-07', '2030-01-09'])
      expect(rows.find((r) => r.date === '2030-01-07')!.status).toBe('completed')
    })

    it('keeps one user out of another user\'s routines', async () => {
      const a = await createUser('rem-g')
      const created = await a.api('/api/routines', {
        method: 'POST',
        body: JSON.stringify({ title: 'Private', start_time: '09:00', end_time: '09:30', timezone: 'UTC', recurrence_rule: 'FREQ=DAILY' }),
      })
      const routine = (await created.json()) as { id: string }
      const b = await createUser('rem-h')
      expect((await b.api(`/api/routines/${routine.id}`)).status).toBe(404)
      const res = await b.api(`/api/routines/${routine.id}/instances/2030-01-07`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
      expect(res.status).toBe(404)
    })
  })
})

describe('notification defaults', () => {
  beforeEach(() => fakes('reset'))

  it('a brand new account gets notified with no settings saved', async () => {
    const host = await createUser('def-a')
    const { data } = await host.client.from('profiles').select('settings').eq('id', host.id).single()
    expect(data!.settings.notifications).toBeUndefined()

    await host.api('/api/notifications/subscribe', { method: 'POST', body: JSON.stringify(pushSubscription('sub-def')) })
    const slug = await bookingLink(host)
    expect((await book(slug, 'guest-def@example.com')).status).toBe(201)
    expect((await recorded()).push).toHaveLength(1)
  })
})
