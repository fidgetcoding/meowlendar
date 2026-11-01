import type { NotificationPayload } from './types'
import { telegramApiBase } from '../external-urls'

export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  payload: NotificationPayload
): Promise<boolean> {
  const text = `<b>${escapeHtml(payload.title)}</b>\n\n${escapeHtml(payload.body)}${payload.url ? `\n\n<a href="${escapeHtml(payload.url)}">Open in Meowlendar</a>` : ''}`

  try {
    const res = await fetch(
      `${telegramApiBase()}/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    )

    if (!res.ok) {
      const body = await res.text()
      console.error('[notifications/telegram] Send failed:', res.status, body)
      return false
    }

    return true
  } catch (err) {
    console.error('[notifications/telegram] Unexpected error:', err)
    return false
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
