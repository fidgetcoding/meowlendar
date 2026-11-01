// Finds the markdown files a connection covers. Read only.
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseMarkdown, type FileLine } from './lines.js'
import { hasForbiddenSegment, isInside, toPosix } from './paths.js'
import type { SkippedEntry } from './types.js'

export interface ScannedFile {
  /** Vault-relative real path with forward slashes. */
  rel: string
  hash: string
  content: string
  lines: FileLine[]
}

export interface ScanResult {
  files: ScannedFile[]
  skipped: SkippedEntry[]
}

export function hashBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface Walk {
  vault: string
  visitedDirs: Set<string>
  fileReals: Set<string>
  skipped: SkippedEntry[]
}

function report(walk: Walk, path: string, reason: string): void {
  walk.skipped.push({ file: toPosix(relative(walk.vault, path)), line: null, id: null, reason })
}

async function followSymlink(walk: Walk, link: string, isMarkdownName: boolean): Promise<void> {
  const real = await realpath(link).catch(() => null)
  if (!real) return report(walk, link, 'Broken symlink, skipped.')
  if (!isInside(walk.vault, real)) return report(walk, link, 'Symlink resolves outside the vault, skipped.')
  if (hasForbiddenSegment(toPosix(relative(walk.vault, real)))) {
    return report(walk, link, 'Symlink resolves into a protected directory, skipped.')
  }
  const info = await stat(real)
  if (info.isDirectory()) return walkDir(walk, real)
  if (info.isFile() && isMarkdownName && real.endsWith('.md')) walk.fileReals.add(real)
}

async function walkDir(walk: Walk, dir: string): Promise<void> {
  if (walk.visitedDirs.has(dir)) return
  walk.visitedDirs.add(dir)
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      await followSymlink(walk, full, entry.name.endsWith('.md'))
    } else if (entry.isDirectory()) {
      // .obsidian, .meowlendar, .git, .trash: none of these hold notes that should sync.
      if (!entry.name.startsWith('.')) await walkDir(walk, full)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      walk.fileReals.add(full)
    }
  }
}

export async function scanFolder(vault: string, folderAbs: string): Promise<ScanResult> {
  const walk: Walk = { vault, visitedDirs: new Set(), fileReals: new Set(), skipped: [] }
  await walkDir(walk, folderAbs)

  const files: ScannedFile[] = []
  for (const abs of [...walk.fileReals].sort()) {
    const bytes = await readFile(abs)
    const content = bytes.toString('utf8')
    // A file that is not valid UTF-8 can't be rewritten without changing other bytes.
    if (!Buffer.from(content, 'utf8').equals(bytes)) {
      report(walk, abs, 'The file is not valid UTF-8, skipped.')
      continue
    }
    files.push({
      rel: toPosix(relative(vault, abs)),
      hash: hashBytes(bytes),
      content,
      lines: parseMarkdown(content),
    })
  }
  walk.skipped.sort((a, b) => a.file.localeCompare(b.file))
  return { files, skipped: walk.skipped }
}
