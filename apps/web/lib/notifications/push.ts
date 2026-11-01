import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationPayload, PushSubscriptionRecord } from './types'

let vapidConfigured = false

function ensureVapid() {
  if (vapidConfigured) return
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv || priv === 'placeholder') {
    throw new Error('VAPID keys not configured')
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@poolendar.com',
    pub,
    priv
  )
  vapidConfigured = true
}

export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  payload: NotificationPayload,
  supabase?: SupabaseClient
): Promise<boolean> {
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
  }

  try {
    ensureVapid()
    await webpush.sendNotification(
      pushSubscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url,
        event: payload.event,
        data: payload.data,
      })
    )
    return true
  } catch (err) {
    const { statusCode, body } = err as { statusCode?: number; body?: unknown }
    if (statusCode === 410 || statusCode === 404) {
      console.warn('[notifications/push] Subscription expired, removing:', subscription.id)
      if (supabase) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('id', subscription.id)
      }
    } else {
      console.error('[notifications/push] Send failed:', statusCode, body)
    }
    return false
  }
}
