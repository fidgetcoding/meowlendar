import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'
it('gives concurrent pulls one lease and refuses renewal or release by an obsolete owner', async () => {
  const user = await createUser('sync-lock')
  const db = serviceClient()
  try {
    const { data: account } = await db.from('google_accounts').insert({ user_id: user.id, email: 'fixture@example.test', access_token: 'fixture', refresh_token: 'fixture', token_expires_at: '2099-01-01T00:00:00Z' }).select().single().throwOnError()
    expect((await user.client.rpc('claim_account_sync', { p_account: account!.id })).error?.code).toBe('42501')
    const calls = await Promise.all([db.rpc('claim_account_sync', { p_account: account!.id }), db.rpc('claim_account_sync', { p_account: account!.id })])
    expect(calls.map(call => call.error)).toEqual([null, null])
    expect(calls.filter(call => call.data)).toHaveLength(1)
    const old = calls.find(call => call.data)!.data as string
    await db.from('account_sync_locks').update({ held_until: '2000-01-01T00:00:00Z' }).eq('account_id', account!.id).throwOnError()
    const next = await db.rpc('claim_account_sync', { p_account: account!.id }).throwOnError()
    expect(next.data).not.toBe(old)
    expect((await db.rpc('renew_account_sync', { p_account: account!.id, p_token: old })).data).toBe(false)
    await db.rpc('release_account_sync', { p_account: account!.id, p_token: old }).throwOnError()
    expect((await db.rpc('claim_account_sync', { p_account: account!.id })).data).toBeNull()
    await db.rpc('release_account_sync', { p_account: account!.id, p_token: next.data }).throwOnError()
    expect((await db.rpc('claim_account_sync', { p_account: account!.id })).data).toBeTruthy()
  } finally { await db.auth.admin.deleteUser(user.id) }
})
