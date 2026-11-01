#!/usr/bin/env node
// Checks prerequisites, starts local Supabase, and writes apps/web/.env.local.
// Safe to re-run: generated secrets and anything you added by hand (Google
// client id and secret, Resend, VAPID) are kept. Never prints a secret.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, 'apps/web/.env.local')

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts })
}

function fail(message) {
  console.error(`\nSetup stopped: ${message}`)
  process.exit(1)
}

function check(label, cmd, args, hint) {
  try {
    run(cmd, args)
    console.log(`ok    ${label}`)
  } catch {
    fail(`${label} is not available. ${hint}`)
  }
}

function parseEnv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

function supabaseStatus() {
  try {
    const status = parseEnv(run('supabase', ['status', '-o', 'env']))
    return status.API_URL && status.ANON_KEY ? status : null
  } catch {
    return null
  }
}

function startSupabase() {
  // A first start pulls images and can miss the health-check window, which the
  // CLI reports as "container is not ready: unhealthy". A second try succeeds.
  for (const attempt of [1, 2]) {
    console.log(`Starting local Supabase (try ${attempt} of 2, the first run downloads images)...`)
    try {
      run('supabase', ['start'], { stdio: ['ignore', 'ignore', 'ignore'] })
      return
    } catch {
      // Falls through to the status check below.
    }
  }
}

const [major] = process.versions.node.split('.').map(Number)
if (major < 20) fail(`Node 20 or newer is required, found ${process.versions.node}.`)
console.log(`ok    node ${process.versions.node}`)
check('pnpm', 'pnpm', ['--version'], 'Install it with: corepack enable')
check('supabase CLI', 'supabase', ['--version'], 'See https://supabase.com/docs/guides/local-development/cli/getting-started')
check('docker daemon', 'docker', ['info'], 'Start Docker Desktop, or run: colima start')

let status = supabaseStatus()
if (!status) {
  startSupabase()
  status = supabaseStatus()
}
if (!status) fail('supabase start did not come up. Run "supabase start" to see why.')
console.log(`ok    supabase running at ${status.API_URL}`)

const existing = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}
const keep = (name, make) => (existing[name] && existing[name] !== 'placeholder' ? existing[name] : make())
const secret = (encoding) => () => randomBytes(32).toString(encoding)

const managed = {
  NEXT_PUBLIC_APP_URL: existing.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET: status.JWT_SECRET,
  GOOGLE_TOKEN_ENC_KEY: keep('GOOGLE_TOKEN_ENC_KEY', secret('base64')),
  GOOGLE_WEBHOOK_SECRET: keep('GOOGLE_WEBHOOK_SECRET', secret('hex')),
  CRON_SECRET: keep('CRON_SECRET', secret('hex')),
}
const merged = { ...existing, ...managed }
const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n')
writeFileSync(envPath, `${body}\n`, { mode: 0o600 })
console.log('ok    wrote apps/web/.env.local')

console.log(`
Next:
  pnpm dev
  open http://localhost:3000 and choose "Sign up" under the email form.
Local mail goes to ${status.INBUCKET_URL}.
Google is optional. See DEPLOY.md.`)
