#!/usr/bin/env node
// Proves what `npx meowlendar-mcp` will do once published. Packs the tarball npm
// would upload, then installs and runs it with an empty npm cache and home
// directory, outside this repo, so nothing from the workspace can leak in.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages/mcp')
const work = mkdtempSync(join(tmpdir(), 'meow-mcp-pack-'))
const home = join(work, 'home')
const app = join(work, 'app')
const MIN_TOOLS = 62
const VAULT_HELP_MARKER = 'the vault wins'

const cleanEnv = {
  PATH: process.env.PATH,
  HOME: home,
  npm_config_cache: join(work, 'npm-cache'),
  npm_config_userconfig: join(work, 'npmrc'),
  npm_config_update_notifier: 'false',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

function handshake(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...cleanEnv, MEOWLENDAR_API_KEY: 'pk_verify', MEOWLENDAR_API_URL: 'http://127.0.0.1:9' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`No answer from the server. stderr: ${stderr.slice(0, 400)}`))
    }, 120_000)
    let stdout = ''
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.stdin.on('error', () => {}) // The child is killed once it has answered.
    child.stdout.on('data', (d) => {
      stdout += d
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n')
        }
        if (msg.id === 2) {
          clearTimeout(timer)
          child.kill()
          resolve(msg.result.tools.length)
        }
      }
    })
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'verify-mcp-pack', version: '1' },
        },
      }) + '\n',
    )
  })
}

function checkVaultHelp(label, command, args, cwd) {
  // No API key on purpose: --help has to work before anything is set up.
  const output = run(command, args, {
    cwd,
    env: { ...cleanEnv, MEOWLENDAR_CONFIG_DIR: join(work, 'config') },
  })
  if (!output.includes(VAULT_HELP_MARKER)) {
    throw new Error(`meowlendar-vault --help via ${label} did not print the conflict rule. Got: ${output.slice(0, 400)}`)
  }
  console.log(`meowlendar-vault --help via ${label}: ok`)
}

try {
  execFileSync('mkdir', ['-p', home, app])
  writeFileSync(join(work, 'npmrc'), '')
  writeFileSync(join(app, 'package.json'), '{"name":"clean-machine","private":true}')

  const packOut = run('npm', ['pack', '--json', '--pack-destination', work], { cwd: pkgDir })
  // The prepack build prints to stdout too, and can include '[' colour codes.
  const packed = JSON.parse(packOut.slice(packOut.search(/^\[\s*$/m)))[0]
  const tarball = join(work, packed.filename)
  const files = packed.files.map((f) => f.path)
  console.log(`packed ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes`)
  const stray = files.filter((f) => !/^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(f))
  if (stray.length) throw new Error(`Unexpected files in the tarball: ${stray.join(', ')}`)

  // `npx -y --package=<tarball>` is the same path as `npx -y meowlendar-mcp`.
  const viaNpx = await handshake(
    'npx',
    ['-y', `--package=${tarball}`, 'meowlendar-mcp'],
    app,
  )
  console.log(`npx from a clean cache: ${viaNpx} tools`)
  if (viaNpx < MIN_TOOLS) throw new Error(`Expected at least ${MIN_TOOLS} tools, got ${viaNpx}`)
  checkVaultHelp('npx', 'npx', ['-y', `--package=${tarball}`, 'meowlendar-vault', '--help'], app)

  run('npm', ['install', '--no-save', tarball], { cwd: app, env: cleanEnv })
  const viaInstall = await handshake(join(app, 'node_modules/.bin/meowlendar-mcp'), [], app)
  console.log(`npm install from a clean cache: ${viaInstall} tools`)
  if (viaInstall < MIN_TOOLS) throw new Error(`Expected at least ${MIN_TOOLS} tools, got ${viaInstall}`)
  checkVaultHelp('npm install', join(app, 'node_modules/.bin/meowlendar-vault'), ['--help'], app)

  console.log('ok: the published package will start from a clean machine')
} finally {
  rmSync(work, { recursive: true, force: true })
}
