// Path safety. Every path the sync touches is decided here, from a real path, and
// re-checked on each run because a folder can turn into a symlink between runs.
import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { VaultError } from './types.js'

export const FORBIDDEN_DIRS = new Set(['.obsidian', '.meowlendar', '.git'])
export const STATE_DIR = '.meowlendar'
export const STATE_FILE = 'sync-state.json'
export const BACKUPS_DIR = 'backups'

export interface ResolvedPaths {
  vault: string
  folder: string
  folderAbs: string
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

export function hasForbiddenSegment(relPath: string): boolean {
  // Lower-cased because the default macOS file system treats .GIT and .git as one folder.
  return relPath.split('/').some((segment) => FORBIDDEN_DIRS.has(segment.toLowerCase()))
}

function checkFolderText(folder: string): void {
  if (folder === '') throw new VaultError('Give a folder inside the vault, or "." for the whole vault.')
  if (isAbsolute(folder)) throw new VaultError(`The folder must be relative to the vault, not absolute: ${folder}`)
  if (folder.includes('\0') || folder.includes('\\')) {
    throw new VaultError(`The folder has a character I do not accept: ${JSON.stringify(folder)}`)
  }
  const segments = folder.split('/')
  if (segments.includes('..')) throw new VaultError(`The folder can't contain "..": ${folder}`)
  if (hasForbiddenSegment(folder)) {
    throw new VaultError(`The folder can't be inside .obsidian, .meowlendar, or .git: ${folder}`)
  }
}

async function realDirectory(path: string, label: string): Promise<string> {
  let real: string
  try {
    real = await realpath(path)
  } catch {
    throw new VaultError(`${label} does not exist: ${path}`)
  }
  if (!(await stat(real)).isDirectory()) throw new VaultError(`${label} is not a directory: ${path}`)
  return real
}

/** Validates a vault and folder and returns their real locations, or throws why not. */
export async function resolveVaultPaths(vaultInput: string, folderInput: string): Promise<ResolvedPaths> {
  checkFolderText(folderInput)
  const vault = await realDirectory(resolve(vaultInput), 'The vault')
  const hasObsidian = await stat(join(vault, '.obsidian')).then(
    (s) => s.isDirectory(),
    () => false,
  )
  if (!hasObsidian) {
    throw new VaultError(`${vault} has no .obsidian directory, so I am not treating it as a vault.`)
  }
  const folderAbs = await realDirectory(join(vault, folderInput), 'The folder')
  if (!isInside(vault, folderAbs)) {
    throw new VaultError(`The folder resolves outside the vault: ${folderInput}`)
  }
  const folder = toPosix(relative(vault, folderAbs))
  if (hasForbiddenSegment(folder)) {
    throw new VaultError(`The folder resolves into .obsidian, .meowlendar, or .git: ${folderInput}`)
  }
  return { vault, folder, folderAbs }
}

async function refuseSymlink(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null)
  if (info?.isSymbolicLink()) {
    throw new VaultError(`${path} is a symlink, so I am refusing to read or write through it.`)
  }
}

/** The state folder is where backups land, so a symlink here would aim writes out of the vault. */
export async function assertStateDirSafe(vault: string): Promise<void> {
  await refuseSymlink(join(vault, STATE_DIR))
  await refuseSymlink(join(vault, STATE_DIR, STATE_FILE))
  await refuseSymlink(join(vault, STATE_DIR, BACKUPS_DIR))
}
