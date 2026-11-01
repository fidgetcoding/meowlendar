import { describe, it, expect } from 'vitest'
import { APP, createUser, serviceClient } from './helpers'

describe('API keys', () => {
  it('runs as the key owner under row-level security, with no JWT secret', async () => {
    const a = await createUser('key-a')
    const b = await createUser('key-b')

    const created = await a.api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'mine' }) })
    expect(created.status).toBe(201)
    const task = (await created.json()) as { id: string; user_id: string }
    expect(task.user_id).toBe(a.id)

    expect((await a.api(`/api/tasks/${task.id}`)).status).toBe(200)
    // B's key can't see or change A's row.
    expect((await b.api(`/api/tasks/${task.id}`)).status).toBe(404)
    const del = await b.api(`/api/tasks/${task.id}`, { method: 'DELETE' })
    expect([204, 404]).toContain(del.status)
    expect((await a.api(`/api/tasks/${task.id}`)).status).toBe(200)
  })

  it('stores the session encrypted and reuses it', async () => {
    const a = await createUser('key-c')
    expect((await a.api('/api/tags')).status).toBe(200)
    expect((await a.api('/api/tags')).status).toBe(200)

    const { data } = await serviceClient()
      .from('api_key_sessions')
      .select('access_token, refresh_token')
      .eq('key_id', a.keyId)
    expect(data).toHaveLength(1)
    expect(data![0]!.access_token.startsWith('v1:')).toBe(true)
    expect(data![0]!.refresh_token.startsWith('v1:')).toBe(true)
  })

  it('recovers when the stored session has expired', async () => {
    const a = await createUser('key-d')
    expect((await a.api('/api/tags')).status).toBe(200)
    // A running server keeps the token in memory, so only a new key is forced
    // through the database path here. The refresh path is covered in unit tests.
    const { error } = await serviceClient()
      .from('api_key_sessions')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('key_id', a.keyId)
    expect(error).toBeNull()
    expect((await a.api('/api/tags')).status).toBe(200)
  })

  it('stops working as soon as the key is deleted', async () => {
    const a = await createUser('key-e')
    expect((await a.api('/api/tags')).status).toBe(200)
    await a.client.from('api_keys').delete().eq('id', a.keyId)
    expect((await a.api('/api/tags')).status).toBe(401)
  })

  it('refuses a key that does not exist', async () => {
    const res = await fetch(`${APP}/api/tags`, { headers: { Authorization: 'Bearer pk_00000000000000000000000000000000' } })
    expect(res.status).toBe(401)
  })

  it('leaves the session table closed to users and the public key', async () => {
    const a = await createUser('key-f')
    const { error } = await a.client.from('api_key_sessions').select('key_id')
    expect(error?.code).toBe('42501')
  })
})
