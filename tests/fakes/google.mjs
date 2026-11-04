// A small in-memory Google Calendar. It follows the behavior the app depends on:
// OAuth code and refresh exchanges, calendarList, per-calendar sync tokens that
// only return changes since they were issued, a 410 for a token it no longer
// honours, etags, If-Match conflicts, watch channels, and extendedProperties.
// It is not Google, and passing against it is not proof against Google.
import { createServer } from 'node:http'

function newState() {
  return {
    seq: 0,
    accounts: new Map(), // email -> { refreshToken, accessToken, calendars: Map }
    codes: new Map(), // code -> email
    tokens: new Map(), // accessToken -> email
    watches: [],
    requests: [],
    failNext: new Map(), // 'METHOD path-fragment' -> status
    revoked: [],
  }
}

export function createGoogleFake() {
  let state = newState()

  const tick = () => ++state.seq
  const etag = (n) => `"etag-${n}"`

  function addAccount(email, calendars = [{ id: email, summary: email, primary: true }]) {
    const account = {
      email,
      refreshToken: `refresh-${email}`,
      calendars: new Map(),
    }
    for (const cal of calendars) addCalendar(account, cal)
    state.accounts.set(email, account)
    return account
  }

  function addCalendar(account, cal) {
    account.calendars.set(cal.id, {
      id: cal.id,
      summary: cal.summary ?? cal.id,
      primary: cal.primary === true,
      accessRole: cal.accessRole ?? 'owner',
      backgroundColor: cal.backgroundColor ?? '#4285F4',
      events: new Map(),
      syncFloor: 0, // tokens older than this get a 410
    })
  }

  function putEvent(cal, input, id) {
    const n = tick()
    const eventId = id ?? input.id ?? `g${n}`
    const prev = cal.events.get(eventId)
    const event = {
      ...(prev ?? {}),
      ...input,
      id: eventId,
      status: input.status ?? prev?.status ?? 'confirmed',
      etag: etag(n),
      updated: new Date().toISOString(),
      __seq: n,
    }
    cal.events.set(eventId, event)
    return event
  }

  const publicEvent = ({ __seq, ...event }) => event

  function send(res, status, body) {
    if (status === 204) {
      res.writeHead(204)
      return res.end()
    }
    res.writeHead(status, { 'Content-Type': 'application/json', ETag: body?.etag ?? '' })
    res.end(JSON.stringify(body ?? {}))
  }

  function accountFor(req) {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '')
    const email = state.tokens.get(token)
    return email ? state.accounts.get(email) : null
  }

  async function handle(req, res) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    const url = new URL(req.url, 'http://fake')
    const path = url.pathname
    state.requests.push({ method: req.method, path, query: url.search, body: raw })

    for (const [key, status] of state.failNext) {
      const [method, fragment] = key.split(' ')
      if (req.method === method && path.includes(fragment)) {
        state.failNext.delete(key)
        return send(res, status, { error: { code: status, message: 'forced failure' } })
      }
    }

    // --- OAuth ---------------------------------------------------------------
    if (path === '/o/oauth2/v2/auth') {
      // The test decides who "signs in" with login_hint on the control channel.
      const email = state.nextLogin
      const code = `code-${tick()}`
      state.codes.set(code, email)
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      redirect.searchParams.set('code', code)
      redirect.searchParams.set('state', url.searchParams.get('state') ?? '')
      res.writeHead(302, { Location: redirect.toString() })
      return res.end()
    }
    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(raw)
      let email = null
      if (form.get('grant_type') === 'authorization_code') {
        email = state.codes.get(form.get('code'))
        state.codes.delete(form.get('code'))
      } else if (form.get('grant_type') === 'refresh_token') {
        for (const account of state.accounts.values()) {
          if (account.refreshToken === form.get('refresh_token')) email = account.email
        }
      }
      if (!email) return send(res, 400, { error: 'invalid_grant' })
      const accessToken = `access-${email}-${tick()}`
      state.tokens.set(accessToken, email)
      return send(res, 200, {
        access_token: accessToken,
        refresh_token: state.accounts.get(email).refreshToken,
        expires_in: 3600,
        token_type: 'Bearer',
      })
    }
    if (path === '/revoke') {
      state.revoked.push(url.searchParams.get('token'))
      return send(res, 200, {})
    }

    const account = accountFor(req)
    if (!account) return send(res, 401, { error: { code: 401, message: 'Invalid Credentials' } })

    if (path === '/oauth2/v2/userinfo') return send(res, 200, { email: account.email })

    // --- calendarList --------------------------------------------------------
    if (path === '/calendar/v3/users/me/calendarList' && req.method === 'GET') {
      return send(res, 200, {
        items: [...account.calendars.values()].map((c) => ({
          id: c.id,
          summary: c.summary,
          primary: c.primary || undefined,
          accessRole: c.accessRole,
          backgroundColor: c.backgroundColor,
        })),
      })
    }
    let m = path.match(/^\/calendar\/v3\/users\/me\/calendarList\/([^/]+)$/)
    if (m && req.method === 'PATCH') {
      const cal = account.calendars.get(decodeURIComponent(m[1]))
      if (!cal) return send(res, 404, {})
      Object.assign(cal, JSON.parse(raw))
      return send(res, 200, { id: cal.id, backgroundColor: cal.backgroundColor })
    }

    // --- freeBusy ------------------------------------------------------------
    if (path === '/calendar/v3/freeBusy' && req.method === 'POST') {
      const input = JSON.parse(raw)
      const calendars = {}
      for (const { id } of input.items ?? []) {
        const cal = id === 'primary' ? [...account.calendars.values()].find((c) => c.primary) : account.calendars.get(id)
        calendars[id] = {
          busy: cal
            ? [...cal.events.values()]
                .filter((e) => e.status !== 'cancelled' && e.start?.dateTime && e.transparency !== 'transparent')
                .map((e) => ({ start: e.start.dateTime, end: e.end.dateTime }))
            : [],
        }
      }
      return send(res, 200, { calendars })
    }

    // --- events --------------------------------------------------------------
    m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/(.+))?$/)
    if (!m) return send(res, 404, { error: { code: 404, message: `no route ${path}` } })
    const wanted = decodeURIComponent(m[1])
    const cal =
      wanted === 'primary'
        ? [...account.calendars.values()].find((c) => c.primary)
        : account.calendars.get(wanted)
    if (!cal) return send(res, 404, { error: { code: 404, message: 'Calendar not found' } })
    const tail = m[2] ? decodeURIComponent(m[2]) : null

    if (tail === 'watch' && req.method === 'POST') {
      const input = JSON.parse(raw)
      const channel = {
        kind: 'api#channel',
        id: input.id,
        resourceId: `res-${tick()}`,
        token: input.token,
        address: input.address,
        calendarId: cal.id,
        expiration: String(Date.now() + 7 * 864e5),
      }
      state.watches.push(channel)
      return send(res, 200, channel)
    }

    if (!tail && req.method === 'GET') {
      const syncToken = url.searchParams.get('syncToken')
      let events = [...cal.events.values()]
      if (syncToken) {
        const parts = syncToken.split(':')
        // A token belongs to one calendar. The real API rejects any other use.
        if (parts[0] !== cal.id) {
          return send(res, 400, { error: { code: 400, message: 'Sync token is not valid for this calendar' } })
        }
        const since = Number(parts[1])
        if (since < cal.syncFloor) {
          return send(res, 410, { error: { code: 410, message: 'Sync token is no longer valid' } })
        }
        events = events.filter((e) => e.__seq > since)
      } else {
        events = events.filter((e) => e.status !== 'cancelled')
      }
      return send(res, 200, {
        items: events.map(publicEvent),
        nextSyncToken: `${cal.id}:${state.seq}`,
      })
    }

    if (!tail && req.method === 'POST') {
      const input = JSON.parse(raw)
      // Google custom IDs use base32hex, not arbitrary strings.
      if (input.id !== undefined && (typeof input.id !== 'string' || !/^[a-v0-9]{5,1024}$/.test(input.id))) {
        return send(res, 400, { error: { code: 400, message: 'Invalid event identifier.' } })
      }
      // As on Google, an id can't be reused, even by a cancelled event.
      if (input.id && cal.events.has(input.id)) {
        return send(res, 409, { error: { code: 409, message: 'The requested identifier already exists.' } })
      }
      const event = putEvent(cal, input)
      if (url.searchParams.get('conferenceDataVersion') === '1' && input.conferenceData?.createRequest) {
        event.hangoutLink = `https://meet.example.test/${event.id}`
      }
      return send(res, 200, publicEvent(event))
    }

    if (tail) {
      const existing = cal.events.get(tail)
      if (req.method === 'GET') {
        if (!existing || existing.status === 'cancelled') return send(res, 404, {})
        return send(res, 200, publicEvent(existing))
      }
      if (req.method === 'PATCH' || req.method === 'PUT') {
        if (!existing) return send(res, 404, { error: { code: 404, message: 'Not Found' } })
        const ifMatch = req.headers['if-match']
        if (ifMatch && ifMatch !== existing.etag) {
          return send(res, 412, { error: { code: 412, message: 'Precondition Failed' } })
        }
        return send(res, 200, publicEvent(putEvent(cal, JSON.parse(raw), tail)))
      }
      if (req.method === 'DELETE') {
        if (!existing || existing.status === 'cancelled') return send(res, 410, {})
        putEvent(cal, { status: 'cancelled' }, tail)
        return send(res, 204)
      }
    }
    return send(res, 404, {})
  }

  return {
    server: createServer((req, res) => {
      handle(req, res).catch((err) => {
        res.writeHead(500)
        res.end(String(err))
      })
    }),
    reset() {
      state = newState()
    },
    // Lets a test act as "someone using Google directly".
    control(action, input) {
      const account = input.email ? state.accounts.get(input.email) : null
      const cal = account && input.calendarId ? account.calendars.get(input.calendarId) : null
      switch (action) {
        case 'add-account':
          addAccount(input.email, input.calendars)
          return { ok: true }
        case 'add-calendar':
          addCalendar(account, input)
          return { ok: true }
        case 'login-as':
          state.nextLogin = input.email
          return { ok: true }
        case 'put-event':
          return publicEvent(putEvent(cal, input.event, input.event.id))
        case 'cancel-event':
          return publicEvent(putEvent(cal, { status: 'cancelled' }, input.id))
        case 'list-events':
          return { items: [...cal.events.values()].map(publicEvent) }
        case 'expire-sync-tokens':
          cal.syncFloor = state.seq + 1
          return { ok: true }
        case 'fail-next':
          state.failNext.set(input.key, input.status)
          return { ok: true }
        case 'state':
          return { requests: state.requests, watches: state.watches, revoked: state.revoked }
        default:
          throw new Error(`unknown control action ${action}`)
      }
    },
  }
}
