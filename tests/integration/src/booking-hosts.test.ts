import { request } from 'node:http'
import { describe, it, expect, beforeAll } from 'vitest'
import { APP, createUser, type TestUser } from './helpers'

// fetch can't set Host, so this speaks plain HTTP.
function get(path: string, host: string, method = 'GET', body?: string): Promise<{ status: number; body: string }> {
  const url = new URL(APP)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: url.port,
        path,
        method,
        headers: { Host: host, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      },
      (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
  day,
  start: '00:00',
  end: '23:59',
}))

describe('booking subdomains and the Host header', () => {
  const port = new URL(APP).port
  let owner: TestUser
  let username: string
  let otherName: string
  const slug = `host-link-${Date.now().toString(36)}`

  beforeAll(async () => {
    owner = await createUser('hostowner')
    const other = await createUser('hostother')
    const { data } = await owner.client.from('profiles').select('username').eq('id', owner.id).single()
    username = data!.username
    const { data: o } = await other.client.from('profiles').select('username').eq('id', other.id).single()
    otherName = o!.username
    const { error } = await owner.client.from('booking_links').insert({
      user_id: owner.id,
      slug,
      name: 'Host link',
      duration_minutes: 30,
      availability: days,
      timezone: 'UTC',
      conferencing: false,
      is_public: true,
    })
    expect(error).toBeNull()
  })

  it('serves the app on its configured host', async () => {
    expect((await get('/login', `localhost:${port}`)).status).toBe(200)
  })

  it.each(['evil.com', 'localhost.evil.com', 'a.b.localhost', 'admin.localhost', 'api.localhost'])(
    'refuses the spoofed host %s with a 421',
    async (host) => {
      const res = await get('/login', `${host}:${port}`)
      expect(res.status).toBe(421)
      // A spoofed host can't reach the API either.
      expect((await get('/api/tags', `${host}:${port}`)).status).toBe(421)
    },
  )

  it('opens a link under its owner', async () => {
    expect((await get(`/${slug}`, `${username}.localhost:${port}`)).status).toBe(200)
    const info = await get(`/api/booking/availability/${slug}?info=true`, `${username}.localhost:${port}`)
    expect(info.status).toBe(200)
    expect(JSON.parse(info.body).booking_link.name).toBe('Host link')
  })

  it("does not open a link under someone else's name", async () => {
    const res = await get(`/api/booking/availability/${slug}?info=true`, `${otherName}.localhost:${port}`)
    expect(res.status).toBe(404)
    const book = await get(
      `/api/booking/book/${slug}`,
      `${otherName}.localhost:${port}`,
      'POST',
      JSON.stringify({ booker_name: 'X', booker_email: 'x@example.com', start_time: new Date(Date.now() + 864e5).toISOString() }),
    )
    expect(book.status).toBe(404)
  })

  it('keeps /book/<slug> working', async () => {
    expect((await get(`/book/${slug}`, `localhost:${port}`)).status).toBe(200)
    expect((await get(`/book/${slug}`, `${username}.localhost:${port}`)).status).toBe(200)
  })

  it('lists public fields only on the host page', async () => {
    const res = await get(`/api/booking/host/${username}`, `${username}.localhost:${port}`)
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(Object.keys(body.links[0]).sort()).toEqual(['duration_minutes', 'name', 'slug'])
    expect(Object.keys(body.host).sort()).toEqual(['avatar_url', 'display_name'])
    expect(res.body).not.toContain(owner.id)
  })

  it('exposes no app routes on a booking subdomain', async () => {
    expect((await get('/api/tags', `${username}.localhost:${port}`)).status).toBe(404)
    expect((await get('/settings/profile', `${username}.localhost:${port}`)).status).toBe(404)
    expect((await get('/api/booking/host/nobody-here', `localhost:${port}`)).status).toBe(404)
  })
})
