import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationChannelConfig } from '@poolendar/types'
import type {
  NotificationChannel,
  NotificationPayload,
  PushSubscriptionRecord,
} from './types'
import { EVENT_TO_SETTINGS_KEY } from './types'
import { sendEmailNotification } from './email'
import { sendPushNotification } from './push'
import { sendTelegramNotification } from './telegram'

interface DispatchResult {
  channel: NotificationChannel
  success: boolean
  error?: string
}

export async function dispatchNotification(
  supabase: SupabaseClient,
  userId: string,
  payload: NotificationPayload
): Promise<DispatchResult[]> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, settings')
    .eq('id', userId)
    .single()

  if (!profile) {
    console.error('[notifications/dispatcher] Profile not found for user:', userId)
    return []
  }

  const settings = profile.settings as Record<string, unknown> | null
  const notifications = settings?.notifications as Record<string, NotificationChannelConfig> | undefined
  const settingsKey = EVENT_TO_SETTINGS_KEY[payload.event]

  const promises: Promise<DispatchResult>[] = []

  if (isChannelEnabled(notifications?.browser_push, settingsKey)) {
    promises.push(dispatchBrowserPush(supabase, userId, payload))
  }

  if (isChannelEnabled(notifications?.email, settingsKey)) {
    promises.push(dispatchEmail(profile.email, payload))
  }

  if (isChannelEnabled(notifications?.in_app, settingsKey)) {
    promises.push(dispatchInApp(supabase, userId, payload))
  }

  if (isChannelEnabled(notifications?.telegram, settingsKey)) {
    const botToken = settings?.telegram_bot_token as string | null
    const chatId = settings?.telegram_chat_id as string | null
    if (botToken && chatId) {
      promises.push(dispatchTelegram(botToken, chatId, payload))
    }
  }

  const results = await Promise.allSettled(promises)

  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { channel: 'in_app' as NotificationChannel, success: false, error: String(r.reason) }
  )
}

export async function dispatchToChannel(
  supabase: SupabaseClient,
  userId: string,
  channel: NotificationChannel,
  payload: NotificationPayload
): Promise<DispatchResult> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, settings')
    .eq('id', userId)
    .single()

  if (!profile) {
    return { channel, success: false, error: 'Profile not found' }
  }

  const settings = profile.settings as Record<string, unknown> | null

  switch (channel) {
    case 'browser_push':
      return dispatchBrowserPush(supabase, userId, payload)
    case 'email':
      return dispatchEmail(profile.email, payload)
    case 'in_app':
      return dispatchInApp(supabase, userId, payload)
    case 'telegram': {
      const botToken = settings?.telegram_bot_token as string | null
      const chatId = settings?.telegram_chat_id as string | null
      if (!botToken || !chatId) {
        return { channel, success: false, error: 'Telegram not configured' }
      }
      return dispatchTelegram(botToken, chatId, payload)
    }
  }
}

function isChannelEnabled(
  config: NotificationChannelConfig | undefined,
  eventKey: string
): boolean {
  if (!config?.enabled) return false
  return (config as unknown as Record<string, unknown>)[eventKey] === true
}

async function dispatchBrowserPush(
  supabase: SupabaseClient,
  userId: string,
  payload: NotificationPayload
): Promise<DispatchResult> {
  try {
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId)

    if (!subscriptions?.length) {
      return { channel: 'browser_push', success: false, error: 'No push subscriptions' }
    }

    const results = await Promise.allSettled(
      subscriptions.map((sub: PushSubscriptionRecord) =>
        sendPushNotification(sub, payload, supabase)
      )
    )

    const anySuccess = results.some(
      (r) => r.status === 'fulfilled' && r.value === true
    )

    return { channel: 'browser_push', success: anySuccess }
  } catch (err) {
    return { channel: 'browser_push', success: false, error: String(err) }
  }
}

async function dispatchEmail(
  email: string | null,
  payload: NotificationPayload
): Promise<DispatchResult> {
  if (!email) {
    return { channel: 'email', success: false, error: 'No email on profile' }
  }

  try {
    const success = await sendEmailNotification(email, payload)
    return { channel: 'email', success }
  } catch (err) {
    return { channel: 'email', success: false, error: String(err) }
  }
}

async function dispatchInApp(
  supabase: SupabaseClient,
  userId: string,
  payload: NotificationPayload
): Promise<DispatchResult> {
  try {
    const channel = supabase.channel(`notifications:${userId}`, {
      config: { private: true },
    })
    await channel.send({
      type: 'broadcast',
      event: 'notification',
      payload,
    })
    supabase.removeChannel(channel)
    return { channel: 'in_app', success: true }
  } catch (err) {
    return { channel: 'in_app', success: false, error: String(err) }
  }
}

async function dispatchTelegram(
  botToken: string,
  chatId: string,
  payload: NotificationPayload
): Promise<DispatchResult> {
  try {
    const success = await sendTelegramNotification(botToken, chatId, payload)
    return { channel: 'telegram', success }
  } catch (err) {
    return { channel: 'telegram', success: false, error: String(err) }
  }
}
