// The list of connected vaults. MCP tools only ever see names from this file, so
// connecting a vault stays a deliberate step a person takes in a terminal.
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic } from './fs-safe.js'
import { VAULT_NAME } from './mapping.js'
import { resolveVaultPaths } from './paths.js'
import { VaultError, type Connection } from './types.js'

export interface ConfigEnv {
  env?: NodeJS.ProcessEnv
  /** Overrides the home directory lookup. */
  home?: string
}

export function configDir({ env = process.env, home }: ConfigEnv = {}): string {
  return env.MEOWLENDAR_CONFIG_DIR || join(home ?? homedir(), '.config', 'meowlendar')
}

function configPath(options: ConfigEnv): string {
  return join(configDir(options), 'vaults.json')
}

function isConnection(value: unknown): value is Connection {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.name === 'string' &&
    typeof c.vault === 'string' &&
    typeof c.folder === 'string' &&
    typeof c.importAppTasks === 'boolean'
  )
}

export async function listConnections(options: ConfigEnv = {}): Promise<Connection[]> {
  const path = configPath(options)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  try {
    const data = JSON.parse(text) as { vaults?: unknown }
    if (Array.isArray(data.vaults) && data.vaults.every(isConnection)) return data.vaults
  } catch {
    // Reported below.
  }
  throw new VaultError(`${path} is not a valid vault config.`)
}

async function saveConnections(connections: Connection[], options: ConfigEnv): Promise<void> {
  const dir = configDir(options)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = configPath(options)
  await writeAtomic(path, `${JSON.stringify({ version: 1, vaults: connections }, null, 2)}\n`, 0o600)
  await chmod(path, 0o600)
}

export function assertValidName(name: string): void {
  if (!VAULT_NAME.test(name)) {
    throw new VaultError(
      `"${name}" can't be a vault name. Use up to 64 letters, numbers, dots, dashes, or underscores, starting with a letter or number.`,
    )
  }
}

export async function connectVault(
  input: { name: string; vault: string; folder: string; importAppTasks: boolean },
  options: ConfigEnv = {},
): Promise<Connection> {
  assertValidName(input.name)
  const paths = await resolveVaultPaths(input.vault, input.folder)
  const existing = await listConnections(options)
  if (existing.some((c) => c.name === input.name)) {
    throw new VaultError(`A vault named "${input.name}" is already connected. Disconnect it first.`)
  }
  // Each vault has one state file, so two connections would read each other's lines as removed.
  const sameVault = existing.find((c) => c.vault === paths.vault)
  if (sameVault) {
    throw new VaultError(`That vault is already connected as "${sameVault.name}". A vault can have one connection.`)
  }
  const connection: Connection = {
    name: input.name,
    vault: paths.vault,
    folder: paths.folder,
    importAppTasks: input.importAppTasks,
  }
  await saveConnections([...existing, connection], options)
  return connection
}

export async function disconnectVault(name: string, options: ConfigEnv = {}): Promise<void> {
  const existing = await listConnections(options)
  if (!existing.some((c) => c.name === name)) throw new VaultError(`No vault named "${name}" is connected.`)
  await saveConnections(existing.filter((c) => c.name !== name), options)
}

/** Looks a connection up by its exact name. Nothing else can select a vault. */
export async function findConnection(name: string, options: ConfigEnv = {}): Promise<Connection> {
  const connection = (await listConnections(options)).find((c) => c.name === name)
  if (!connection) throw new VaultError(`No vault named "${name}" is connected.`)
  return connection
}
