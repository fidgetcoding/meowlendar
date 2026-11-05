import { NextResponse } from 'next/server'

// Whether this install has the local demo account (demo@meowlendar.com), so the sign-in page can
// offer it. `pnpm setup:local` sets DEMO_ACCOUNT=1 once it has made the account; a hosted deploy
// never has it unless someone sets it on purpose. Public and cheap: one flag, no database call.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { available: process.env.DEMO_ACCOUNT === '1' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
