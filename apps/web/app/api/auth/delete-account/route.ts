import { NextRequest, NextResponse } from 'next/server'
import { authenticate, isAuthError } from '@/lib/auth/helpers'
import { disconnectGoogleAccount } from '@/lib/google/oauth'

export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request)
  if (isAuthError(auth)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { userId, supabase } = auth

  // Revoke Google's grant first. Deleting the rows alone would leave it alive,
  // and the tokens needed to revoke it go with them. A failed revoke must not
  // trap the user in an account they asked to delete.
  const { data: accounts } = await supabase
    .from('google_accounts')
    .select('id')
    .eq('user_id', userId)
  for (const account of accounts ?? []) {
    try {
      await disconnectGoogleAccount(account.id as string)
    } catch (err) {
      console.error('[delete-account] Google disconnect failed:', err)
    }
  }

  const { createClient } = await import('@supabase/supabase-js')
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await adminClient.auth.admin.deleteUser(userId)
  if (error) {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
