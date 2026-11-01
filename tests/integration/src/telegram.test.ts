import { describe, it, expect, beforeEach } from 'vitest'
import { browserApi, createUser, fakes, serviceClient, type TestUser } from './helpers'

// Against a local fake Telegram server, not the real one.
const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ'

async function enableTelegram(user: TestUser) {
  const on = { enabled: true, reminders: true, due_dates: true, bookings: true, schedule_changes: true }
  const { data } = await user.client.from('profiles').select('settings').eq('id', user.id).single()
  const { error } = await user.client
    .from('profiles')
    .update({ settings: { ...data!.settings, telegram_chat_id: '42', notifications: { telegram: on } } })
    .eq('id', user.id)
  expect(error).toBeNull()
}

describe('Telegram tokens', () => {
  beforeEach(() => fakes('reset'))

  it('saves through a browser session, encrypted, and never returns it', async () => {
    const user = await createUser('tg-a')
    const put = await browserApi(user, '/api/telegram/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) })
    expect(put.status).toBe(200)
    expect(await put.text()).not.toContain(TOKEN)

    const { data } = await serviceClient().from('user_secrets').select('telegram_bot_token').eq('user_id', user.id).single()
    expect(data!.telegram_bot_token.startsWith('v1:')).toBe(true)
    expect(data!.telegram_bot_token).not.toContain(TOKEN)

    const get = await browserApi(user, '/api/telegram/token')
    expect(await get.json()).toEqual({ configured: true })
  })

  it('refuses an API key, so an agent cannot redirect notifications', async () => {
    const user = await createUser('tg-b')
    const res = await user.api('/api/telegram/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) })
    expect(res.status).toBe(403)
    expect((await user.api('/api/telegram/token', { method: 'DELETE' })).status).toBe(403)
  })

  it('refuses malformed tokens and anonymous callers', async () => {
    const user = await createUser('tg-c')
    const bad = await browserApi(user, '/api/telegram/token', { method: 'PUT', body: JSON.stringify({ token: 'nope' }) })
    expect(bad.status).toBe(422)
    const anon = await fetch(`${process.env.MEOW_APP_URL}/api/telegram/token`, { method: 'PUT', body: '{}' })
    expect(anon.status).toBe(401)
  })

  it('keeps tokens out of settings even when written there directly', async () => {
    const user = await createUser('tg-d')
    const { data: before } = await user.client.from('profiles').select('settings').eq('id', user.id).single()
    await user.client
      .from('profiles')
      .update({ settings: { ...before!.settings, telegram_bot_token: TOKEN } })
      .eq('id', user.id)
    const { data: after } = await user.client.from('profiles').select('settings').eq('id', user.id).single()
    expect(after!.settings.telegram_bot_token).toBeUndefined()
  })

  it('closes the secrets table to its owner', async () => {
    const user = await createUser('tg-e')
    const { error } = await user.client.from('user_secrets').select('*')
    expect(error?.code).toBe('42501')
  })

  it('sends with the stored token', async () => {
    const user = await createUser('tg-f')
    await enableTelegram(user)
    await browserApi(user, '/api/telegram/token', { method: 'PUT', body: JSON.stringify({ token: TOKEN }) })

    const res = await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'telegram' }) })
    expect(res.status).toBe(200)

    const { telegram } = await fakes<{ telegram: { token: string; chat_id: string; text: string }[] }>('recorded')
    expect(telegram).toHaveLength(1)
    expect(telegram[0]).toMatchObject({ token: TOKEN, chat_id: '42' })
    expect(telegram[0]!.text).toContain('Test Notification')
  })

  it('reports a failure when Telegram refuses the token', async () => {
    const user = await createUser('tg-g')
    await enableTelegram(user)
    await browserApi(user, '/api/telegram/token', { method: 'PUT', body: JSON.stringify({ token: '999:badbadbadbadbadbadbadbadbad' }) })
    const res = await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'telegram' }) })
    expect(res.status).toBe(422)
  })

  it('says so when no token is set', async () => {
    const user = await createUser('tg-h')
    await enableTelegram(user)
    const res = await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'telegram' }) })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toMatch(/not configured/i)
  })

  it('encrypts a token migrated from the old location on first use', async () => {
    const user = await createUser('tg-i')
    await enableTelegram(user)
    const service = serviceClient()
    await service.from('user_secrets').upsert({ user_id: user.id, telegram_bot_token_legacy: TOKEN })

    const res = await user.api('/api/notifications/test', { method: 'POST', body: JSON.stringify({ channel: 'telegram' }) })
    expect(res.status).toBe(200)

    const { data } = await service.from('user_secrets').select('*').eq('user_id', user.id).single()
    expect(data!.telegram_bot_token_legacy).toBeNull()
    expect(data!.telegram_bot_token.startsWith('v1:')).toBe(true)
  })
})
