#!/usr/bin/env node
// Local stand-ins for outside services, used only by the integration tests. They
// accept requests the way the real services do and record what they received.
// A pass here shows the app's side of the conversation works. It does not prove
// anything about the real Google, Resend, Telegram or web push services.
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGoogleFake } from './google.mjs'

export const PORTS = { google: 4101, telegram: 4102, resend: 4103, push: 4104, control: 4105 }

const recorded = { telegram: [], resend: [], push: [] }
let pushStatus = 201

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const google = createGoogleFake()

const telegram = createServer(async (req, res) => {
  const body = await readBody(req)
  const match = req.url.match(/^\/bot([^/]+)\/sendMessage$/)
  if (!match) return json(res, 404, { ok: false })
  // The real API refuses an unknown bot token with 401.
  if (match[1].includes(':bad')) return json(res, 401, { ok: false, description: 'Unauthorized' })
  recorded.telegram.push({ token: match[1], ...JSON.parse(body.toString()) })
  json(res, 200, { ok: true, result: { message_id: recorded.telegram.length } })
})

const resend = createServer(async (req, res) => {
  const body = await readBody(req)
  if (req.method === 'POST' && req.url === '/emails') {
    recorded.resend.push({ authorization: req.headers.authorization, ...JSON.parse(body.toString()) })
    return json(res, 200, { id: `fake-${recorded.resend.length}` })
  }
  json(res, 404, { message: 'not found' })
})

// web-push always speaks HTTPS, so this one needs a throwaway certificate.
const certDir = mkdtempSync(join(tmpdir(), 'meow-fake-tls-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-keyout', join(certDir, 'k.pem'), '-out', join(certDir, 'c.pem')],
  { stdio: 'ignore' })
const push = createHttpsServer(
  { key: readFileSync(join(certDir, 'k.pem')), cert: readFileSync(join(certDir, 'c.pem')) },
  async (req, res) => {
    const body = await readBody(req)
    recorded.push.push({
      url: req.url,
      authorization: req.headers.authorization ?? null,
      encoding: req.headers['content-encoding'] ?? null,
      ttl: req.headers.ttl ?? null,
      bytes: body.length,
    })
    res.writeHead(pushStatus)
    res.end()
  },
)

// Test control: read what was recorded, reset, and drive the fake Google account.
const control = createServer(async (req, res) => {
  const body = await readBody(req)
  const input = body.length ? JSON.parse(body.toString()) : {}
  if (req.url === '/recorded') return json(res, 200, recorded)
  if (req.url === '/reset') {
    recorded.telegram.length = 0
    recorded.resend.length = 0
    recorded.push.length = 0
    pushStatus = 201
    google.reset()
    return json(res, 200, { ok: true })
  }
  if (req.url === '/push-status') {
    pushStatus = input.status
    return json(res, 200, { ok: true })
  }
  if (req.url.startsWith('/google/')) {
    return json(res, 200, google.control(req.url.slice('/google/'.length), input) ?? { ok: true })
  }
  json(res, 404, {})
})

google.server.listen(PORTS.google, '127.0.0.1')
telegram.listen(PORTS.telegram, '127.0.0.1')
resend.listen(PORTS.resend, '127.0.0.1')
push.listen(PORTS.push, '127.0.0.1')
control.listen(PORTS.control, '127.0.0.1', () => console.log('fakes ready'))
