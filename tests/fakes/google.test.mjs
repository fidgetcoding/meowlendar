import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGoogleFake } from './google.mjs'

test('fake Google enforces the custom event ID alphabet and length', async () => {
  const fake = createGoogleFake()
  fake.control('add-account', { email: 'fixture@example.test' })
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${fake.server.address().port}`
  try {
    const auth = await fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'refresh-fixture@example.test' }) })
    const { access_token } = await auth.json()
    const insert = (id) => fetch(`${base}/calendar/v3/calendars/primary/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, summary: 'Fixture', start: { dateTime: '2026-01-01T09:00:00Z' }, end: { dateTime: '2026-01-01T10:00:00Z' } }),
    })
    for (const id of ['mw00000000000040008000000000000001', 'abcd', 'A1234', '']) {
      assert.equal((await insert(id)).status, 400, `reject ${id}`)
    }
    const valid = 'mt00000000000040008000000000000001'
    assert.equal((await insert(valid)).status, 200)
    assert.equal((await insert(valid)).status, 409)
  } finally {
    fake.server.closeAllConnections()
    await new Promise((resolve) => fake.server.close(resolve))
  }
})
