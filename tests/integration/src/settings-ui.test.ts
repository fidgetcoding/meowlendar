import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from '@playwright/test'
import { SILENT_LAUNCH, stubSoundAndSpeech } from '../../../e2e/silent-browser'
import { APP, createUser, fakes, serviceClient, type TestUser } from './helpers'

// Clicks through the real UI in a browser, with a local fake standing in for Google.

const EVENT = '[data-calendar-item][data-item-type="event"]'

describe('calendar settings in a real browser, against fake Google', () => {
  let browser: Browser
  let page: Page
  let user: TestUser
  const email = `ui${Date.now().toString(36)}@gmail.test`

  /** Noon tomorrow, or today on the last day of the week, so it's in the visible week. */
  function visibleNoon(): Date {
    const d = new Date()
    if (d.getDay() !== 6) d.setDate(d.getDate() + 1)
    d.setHours(12, 0, 0, 0)
    return d
  }

  const remoteEvent = (id: string, summary: string) => {
    const start = visibleNoon()
    return { id, summary, start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 3_600_000).toISOString() } }
  }

  async function openCalendarSettings() {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Calendars' }).first().click()
  }

  beforeAll(async () => {
    await fakes('reset')
    await fakes('google/add-account', {
      email,
      calendars: [{ id: email, summary: 'Main', primary: true }, { id: 'work@group.test', summary: 'Work' }],
    })
    await fakes('google/put-event', { email, calendarId: 'work@group.test', event: remoteEvent('w1', 'Work meeting') })
    await fakes('google/login-as', { email })

    user = await createUser('ui')
    browser = await chromium.launch(SILENT_LAUNCH)
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    await context.addInitScript(stubSoundAndSpeech)
    page = await context.newPage()

    await page.goto(`${APP}/login`)
    await page.getByRole('textbox', { name: /email/i }).fill(user.email)
    await page.locator('input[type="password"]').fill(user.password)
    await page.getByRole('button', { name: /sign in with email/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'))
    await page.locator('[data-day-column]').first().waitFor()
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('connects through the real redirect and shows every calendar', async () => {
    await openCalendarSettings()
    await page.getByRole('button', { name: 'Connect Google Account' }).click()
    await page.waitForURL((u) => u.searchParams.get('google_connected') === 'true')

    await expect.poll(() => page.locator(EVENT).filter({ hasText: 'Work meeting' }).count(), { timeout: 15_000 }).toBeGreaterThan(0)

    await openCalendarSettings()
    const body = page.locator('body')
    await expect.poll(() => body.innerText()).toContain(email)
    const text = await body.innerText()
    expect(text).toContain('Main')
    expect(text).toContain('Work')
    // The local calendar's name is an editable input, so it isn't in the page text.
    expect(await page.getByLabel('Name of My Calendar').inputValue()).toBe('My Calendar')
    await page.keyboard.press('Escape')
  })

  it('turning a calendar off takes its events off the grid', async () => {
    await page.reload()
    await page.locator(EVENT).filter({ hasText: 'Work meeting' }).first().waitFor()
    await openCalendarSettings()
    await page.getByRole('switch', { name: /Work/ }).first().click()
    await expect.poll(async () => {
      const { data } = await serviceClient().from('calendars').select('is_active').eq('user_id', user.id).eq('name', 'Work').single()
      return data?.is_active
    }).toBe(false)

    await page.reload()
    await page.locator('[data-day-column]').first().waitFor()
    await page.waitForLoadState('networkidle')
    expect(await page.locator(EVENT).filter({ hasText: 'Work meeting' }).count()).toBe(0)
  })

  it('choosing where tasks go sends a scheduled task to Google, and Off takes it back', async () => {
    const start = visibleNoon()
    const res = await user.api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Task for Google',
        scheduled_start: start.toISOString(),
        scheduled_end: new Date(start.getTime() + 1_800_000).toISOString(),
      }),
    })
    expect(res.status).toBe(201)

    const confirmed = async () => {
      const { items } = await fakes<{ items: { summary: string; status: string }[] }>('google/list-events', { email, calendarId: email })
      return items.filter((e) => e.status === 'confirmed').map((e) => e.summary)
    }

    await openCalendarSettings()
    await page.getByLabel('Send scheduled tasks to').selectOption({ label: 'Main' })
    await expect.poll(confirmed, { timeout: 15_000 }).toEqual(['Task for Google'])
    // It stays a task on the grid and shows only once.
    await page.reload()
    await page.locator('[data-day-column]').first().waitFor()
    await page.waitForLoadState('networkidle')
    expect(await page.locator('[data-calendar-item]').filter({ hasText: 'Task for Google' }).count()).toBe(1)

    await openCalendarSettings()
    await page.getByLabel('Send scheduled tasks to').selectOption({ label: 'Off' })
    await expect.poll(confirmed, { timeout: 15_000 }).toEqual([])
  })
})
