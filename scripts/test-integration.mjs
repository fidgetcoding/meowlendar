#!/usr/bin/env node
// Runs tests/integration against a real local Supabase stack, a running copy of
// the app, and local fake servers for Google, Resend, Telegram and web push.
//
// You start Supabase yourself and pass its values in the environment, so this
// script can never point at a stack you didn't choose:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Fake-server results show the app's side works. They are not proof against the
// real services.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.INTEGRATION_APP_PORT ?? '3210'
const APP_URL = `http://localhost:${PORT}`

for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[name]) {
    console.error(`Set ${name} to a local stack you started for this run.`)
    process.exit(1)
  }
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error('Refusing to run against a Supabase URL that is not local.')
  process.exit(1)
}

const CRON_SECRET = randomBytes(16).toString('hex')
const appEnv = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_PUBLIC_APP_URL: APP_URL,
  GOOGLE_TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
  GOOGLE_WEBHOOK_SECRET: randomBytes(16).toString('hex'),
  CRON_SECRET,
  GOOGLE_CLIENT_ID: 'fake-client-id',
  GOOGLE_CLIENT_SECRET: 'fake-client-secret',
  GOOGLE_API_BASE_URL: 'http://127.0.0.1:4101',
  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:4102',
  RESEND_BASE_URL: 'http://127.0.0.1:4103',
  RESEND_API_KEY: 're_fake',
  RESEND_FROM_EMAIL: 'Meowlendar <noreply@example.test>',
  // Only web-push talks to the self-signed fake, and only in this test process.
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  SCHEDULER_INTERVAL_SECONDS: process.env.SCHEDULER_INTERVAL_SECONDS ?? '0',
  ...JSON.parse(process.env.INTEGRATION_EXTRA_ENV ?? '{}'),
}
delete appEnv.SUPABASE_JWT_SECRET

function start(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts })
  children.push(child)
  return child
}
const children = []
function stopAll() {
  for (const child of children) child.kill('SIGTERM')
}

async function waitFor(url, label) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} did not start`)
}

let exitCode = 1
try {
  start('node', [join(root, 'tests/fakes/server.mjs')], { env: process.env })
  await waitFor('http://127.0.0.1:4105/recorded', 'fake servers')

  if (!process.env.INTEGRATION_SKIP_BUILD) {
    await new Promise((resolve, reject) => {
      const build = spawn('pnpm', ['--filter', '@poolendar/web', 'build'], { cwd: root, env: appEnv, stdio: 'inherit' })
      build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build failed'))))
    })
  }
  start('pnpm', ['--filter', '@poolendar/web', 'exec', 'next', 'start', '-p', PORT], { cwd: root, env: appEnv })
  await waitFor(`${APP_URL}/login`, 'the app')

  // Lets a test start a second copy of the app with its own settings.
  const envFile = join(mkdtempSync(join(tmpdir(), 'meow-integration-')), 'app-env.json')
  writeFileSync(envFile, JSON.stringify(appEnv), { mode: 0o600 })

  exitCode = await new Promise((resolve) => {
    const args = ['--filter', '@poolendar/integration', 'exec', 'vitest', 'run', ...process.argv.slice(2)]
    const tests = spawn('pnpm', args, {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        MEOW_APP_URL: APP_URL,
        MEOW_CRON_SECRET: CRON_SECRET,
        MEOW_MCP_ENTRY: join(root, 'packages/mcp/dist/index.js'),
        MEOW_APP_ENV_FILE: envFile,
      },
    })
    tests.on('exit', (code) => resolve(code ?? 1))
  })
} catch (err) {
  console.error(err)
} finally {
  stopAll()
}
process.exit(exitCode)
