// The only code that writes to disk: temp file in the same directory, then rename.
import { randomBytes } from 'node:crypto'
import { chmod, copyFile, constants, lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { hashBytes } from './scan.js'
import { BACKUPS_DIR, STATE_DIR, STATE_FILE } from './paths.js'

/** Writes through a temp file so a crash leaves the old file or the new one, never half of one. */
export async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    const handle = await open(temp, 'wx', mode)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temp, mode)
    await rename(temp, path)
  } catch (err) {
    await unlink(temp).catch(() => undefined)
    throw err
  }
}

function timestampSlug(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

/** Copies each existing file about to change, plus the state file, into a new backup folder. */
export async function backupFiles(vault: string, files: string[], now: Date): Promise<string> {
  const root = join(vault, STATE_DIR, BACKUPS_DIR)
  await mkdir(root, { recursive: true })
  const base = timestampSlug(now)
  let dirName = base
  for (let attempt = 1; ; attempt++) {
    try {
      await mkdir(join(root, dirName))
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      dirName = `${base}-${attempt}`
    }
  }
  const backupDir = join(root, dirName)
  for (const rel of [...files, join(STATE_DIR, STATE_FILE)]) {
    const source = join(vault, rel)
    const exists = await lstat(source).then(
      () => true,
      () => false,
    )
    if (!exists) continue
    const target = join(backupDir, rel)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target, constants.COPYFILE_EXCL)
  }
  return join(STATE_DIR, BACKUPS_DIR, dirName)
}

export type GuardedWrite = { written: true } | { written: false; reason: string }

/**
 * Re-reads the file and writes only if it is still what the plan read. `expectedHash`
 * is null for a file that should not exist yet.
 */
export async function writeIfUnchanged(
  abs: string,
  expectedHash: string | null,
  content: string,
): Promise<GuardedWrite> {
  const dir = dirname(abs)
  if ((await realpath(dir)) !== dir) return { written: false, reason: 'Its folder moved or became a symlink since the plan.' }
  const info = await lstat(abs).catch(() => null)
  if (expectedHash === null) {
    if (info) return { written: false, reason: 'A file appeared here since the plan.' }
    await writeAtomic(abs, content, 0o644)
    return { written: true }
  }
  if (!info) return { written: false, reason: 'The file was removed since the plan.' }
  if (!info.isFile()) return { written: false, reason: 'The file is no longer a regular file.' }
  const current = await readFile(abs)
  if (hashBytes(current) !== expectedHash) return { written: false, reason: 'The file was edited since the plan.' }
  const { mode } = await stat(abs)
  await writeAtomic(abs, content, mode & 0o777)
  return { written: true }
}
