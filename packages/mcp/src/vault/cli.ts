// The meowlendar-vault command. Takes its streams and API as arguments so tests can
// drive it directly; vault-cli.ts is the thin entry that wires up the real ones.
import { parseArgs } from 'node:util'
import { connectVault, configDir, disconnectVault, listConnections, type ConfigEnv } from './config.js'
import { formatApplyResult, formatPlan } from './report.js'
import { applyVault, planVault } from './session.js'
import { CONFLICT_RULE, VaultError, type TasksApi } from './types.js'

export const HELP = `meowlendar-vault: two-way sync between Obsidian Tasks lines and Meowlendar tasks.

It runs on your machine and talks to the app over its REST API. It works on any
Obsidian vault using the Obsidian Tasks plugin format.

Usage:
  meowlendar-vault connect --name <name> --vault <path> --folder <relative> [--no-import-app-tasks]
  meowlendar-vault list
  meowlendar-vault disconnect --name <name>
  meowlendar-vault plan --name <name> [--json] [--no-import-app-tasks]
  meowlendar-vault apply --name <name> --plan <id> [--json] [--no-import-app-tasks]
  meowlendar-vault --help

How a sync works:
  plan shows every change and writes nothing to the vault or the app. It prints a
  plan ID, a hash of the plan and of the files it read. apply takes that ID, works
  the plan out again, and refuses if anything changed. There is no way to apply
  without a plan ID.

Conflicts:
  ${CONFLICT_RULE}

What syncs:
  Task text, [ ] [/] [x], the due date, priority, and the done date. Scheduled and
  start dates, recurrence, and tags stay in the vault only.

Nothing gets deleted:
  A line removed from the vault leaves the task in the app, without its link. A task
  deleted in the app leaves the line, marked [-] with a cancelled date.

New on either side:
  A new line creates a task. A new app task is added to <folder>/Meowlendar.md,
  unless you pass --no-import-app-tasks. On connect it is saved for that vault. On
  plan and apply it counts for that run, so pass it to both.

Backups:
  Before writing, every file about to change and the state file are copied to
  <vault>/.meowlendar/backups/<timestamp>/.

Limits on paths:
  The vault needs a .obsidian directory. The folder has to be inside it, and can't
  use "..", be absolute, or sit in .obsidian, .meowlendar, or .git. Only .md files
  are read. Symlinks that lead out of the vault are skipped and reported.

Environment:
  MEOWLENDAR_API_KEY     An API key from Settings > API Keys. Needed by plan and apply.
  MEOWLENDAR_API_URL     Your instance. Default http://localhost:3000.
  MEOWLENDAR_CONFIG_DIR  Where vaults.json lives. Default ~/.config/meowlendar.
`

export interface CliIo extends ConfigEnv {
  stdout: (text: string) => void
  stderr: (text: string) => void
  /** Called only by the commands that talk to the app. Throws if there is no key. */
  createApi: () => TasksApi
  now?: () => Date
}

const OPTIONS = {
  name: { type: 'string' },
  vault: { type: 'string' },
  folder: { type: 'string' },
  plan: { type: 'string' },
  json: { type: 'boolean' },
  'no-import-app-tasks': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

type FlagName = keyof typeof OPTIONS

// Which flags each command takes. Anything else is an error, so a stray --vault on
// plan can't look like it aimed the sync somewhere.
const COMMAND_FLAGS: Record<string, FlagName[]> = {
  connect: ['name', 'vault', 'folder', 'no-import-app-tasks'],
  list: [],
  disconnect: ['name'],
  plan: ['name', 'json', 'no-import-app-tasks'],
  apply: ['name', 'plan', 'json', 'no-import-app-tasks'],
}

class UsageError extends Error {}

function checkFlags(command: string, values: Partial<Record<FlagName, unknown>>): void {
  const allowed = COMMAND_FLAGS[command]
  if (!allowed) throw new UsageError(`Unknown command: ${command}`)
  const extra = (Object.keys(values) as FlagName[]).filter((flag) => !allowed.includes(flag))
  if (extra.length > 0) throw new UsageError(`${command} does not take --${extra.join(', --')}.`)
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new UsageError(`${flag} is required.`)
  return value
}

async function run(argv: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true })
  const command = positionals[0]
  if (values.help || !command) {
    io.stdout(HELP)
    return 0
  }
  if (positionals.length > 1) throw new UsageError(`Unexpected argument: ${positionals[1]}`)
  checkFlags(command, values)
  const noImport = values['no-import-app-tasks'] === true

  switch (command) {
    case 'connect': {
      const connection = await connectVault(
        {
          name: required(values.name, '--name'),
          vault: required(values.vault, '--vault'),
          folder: required(values.folder, '--folder'),
          importAppTasks: !noImport,
        },
        io,
      )
      io.stdout(
        `Connected "${connection.name}": ${connection.vault}, folder ${connection.folder === '' ? '(whole vault)' : connection.folder}.\nSaved in ${configDir(io)}/vaults.json. Nothing has synced yet. Run: meowlendar-vault plan --name ${connection.name}\n`,
      )
      return 0
    }
    case 'list': {
      const connections = await listConnections(io)
      if (connections.length === 0) io.stdout('No vaults connected.\n')
      for (const c of connections) {
        const imports = c.importAppTasks ? 'imports app tasks' : 'does not import app tasks'
        io.stdout(`${c.name}: ${c.vault}, folder ${c.folder === '' ? '(whole vault)' : c.folder}, ${imports}\n`)
      }
      return 0
    }
    case 'disconnect': {
      const name = required(values.name, '--name')
      await disconnectVault(name, io)
      io.stdout(`Disconnected "${name}". The vault, its sync state, and the app's tasks were not touched.\n`)
      return 0
    }
    case 'plan': {
      const plan = await planVault(required(values.name, '--name'), {
        ...io,
        api: io.createApi(),
        noImportAppTasks: noImport,
      })
      io.stdout(values.json ? `${JSON.stringify(plan, null, 2)}\n` : `${formatPlan(plan)}\n`)
      return 0
    }
    case 'apply': {
      const name = required(values.name, '--name')
      const planId = required(values.plan, '--plan')
      const result = await applyVault(name, planId, { ...io, api: io.createApi(), noImportAppTasks: noImport })
      io.stdout(values.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatApplyResult(result)}\n`)
      return result.status === 'partial' ? 1 : 0
    }
    default:
      return 2
  }
}

/** Runs one command and returns the process exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    return await run(argv, io)
  } catch (err) {
    if (err instanceof UsageError || (err as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')) {
      io.stderr(`${(err as Error).message}\nRun meowlendar-vault --help for usage.\n`)
      return 2
    }
    if (err instanceof VaultError) {
      io.stderr(`${err.message}\n`)
      return 1
    }
    io.stderr(`meowlendar-vault: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
