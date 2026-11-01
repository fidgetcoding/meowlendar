// Triggered by a scheduler with a CRON_SECRET bearer. The job itself is in lib/cron.
import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/auth/cron'
import { runReminders } from '@/lib/cron/reminders'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await runReminders())
  } catch (error) {
    console.error('Cron reminders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}
