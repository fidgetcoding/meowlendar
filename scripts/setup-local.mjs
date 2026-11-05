#!/usr/bin/env node
// Checks prerequisites, starts local Supabase, writes apps/web/.env.local, and
// creates the demo account (demo@meowlendar.com / meowlendar) with a sample week.
// Safe to re-run: generated secrets and anything you added by hand (Google
// client id and secret, Resend, VAPID) are kept, and an existing demo account is
// left alone. Never prints a secret.
//
//   --no-demo     skip the demo account
//   --reset-demo  delete the demo account and seed a fresh week
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_EMAIL, DEMO_PASSWORD, isLocalSupabaseUrl, seedDemoAccount } from './demo-account.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, 'apps/web/.env.local')
const flags = new Set(process.argv.slice(2))

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
if (major < 22) fail(`Node 22 or newer is required, found ${process.versions.node}.`)
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
  GOOGLE_TOKEN_ENC_KEY: keep('GOOGLE_TOKEN_ENC_KEY', secret('base64')),
  GOOGLE_WEBHOOK_SECRET: keep('GOOGLE_WEBHOOK_SECRET', secret('hex')),
  CRON_SECRET: keep('CRON_SECRET', secret('hex')),
}
const merged = { ...existing, ...managed }
function writeEnv() {
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n')
  writeFileSync(envPath, `${body}\n`, { mode: 0o600 })
}
writeEnv()
console.log('ok    wrote apps/web/.env.local')

// The demo account, on this machine's Supabase only. DEMO_ACCOUNT=1 lets the sign-in page
// offer it; a hosted deploy never has that unless someone sets it on purpose.
let demo = false
if (flags.has('--no-demo')) {
  console.log('skip  demo account (--no-demo)')
  demo = merged.DEMO_ACCOUNT === '1'
} else if (!isLocalSupabaseUrl(status.API_URL)) {
  console.log('skip  demo account: Supabase is not on this machine')
} else {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const result = await seedDemoAccount({
      url: status.API_URL,
      anonKey: status.ANON_KEY,
      serviceRoleKey: status.SERVICE_ROLE_KEY,
      reset: flags.has('--reset-demo'),
      createClient,
    })
    const said = { created: 'created with a sample week', reset: 'reset with a fresh week', exists: 'already set up (--reset-demo makes a fresh week)' }
    console.log(`ok    demo account ${said[result]}`)
    demo = true
  } catch (err) {
    console.log(`warn  demo account not created: ${err instanceof Error ? err.message : String(err)}`)
  }
}
merged.DEMO_ACCOUNT = demo ? '1' : '0'
writeEnv()

console.log(`
Next:
  pnpm dev
  open http://localhost:3000${demo ? ` and sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD} to see a sample week,
  or choose "Sign up" under the email form to make your own account.` : ' and choose "Sign up" under the email form.'}
Local mail goes to ${status.INBUCKET_URL}.
Google is optional. See DEPLOY.md.`)
