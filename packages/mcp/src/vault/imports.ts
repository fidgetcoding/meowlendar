// New app tasks become lines at the end of <folder>/Meowlendar.md.
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeTitle, parseMarkdown, renderNewLine, type FileLine } from './lines.js'
import { fieldsFromApp, importId, statusChar, vaultRef } from './mapping.js'
import { IMPORT_FILE_NAME, type ApiOp, type ClassifiedLines, type Draft, type FileWrite } from './plan-types.js'
import type { ScannedFile } from './scan.js'
import type { AppTask, SyncFields } from './types.js'

interface ImportLine {
  id: string
  raw: string
  op: ApiOp | null
  entryFields: SyncFields
  taskId: string
  appCompletedAt: string | null
  title: string
}

function importsFromApp(draft: Draft, lines: ClassifiedLines, tasks: AppTask[]): ImportLine[] {
  const { name } = draft.ctx.connection
  const prefix = `${name}:`
  const ordered = [...tasks].sort(
    (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id),
  )
  const out: ImportLine[] = []
  for (const task of ordered) {
    let id: string
    let needsLink = false
    if (task.vault_ref === null) {
      if (draft.state.detached[task.id] !== undefined || draft.linkedTaskIds.has(task.id)) continue
      id = importId(task.id)
      for (let salt = 1; draft.usedIds.has(id); salt++) id = importId(`${task.id}\0${salt}`)
      draft.usedIds.add(id)
      needsLink = true
    } else if (task.vault_ref.startsWith(prefix)) {
      // Linked, yet neither a line nor a state entry knows it: the state file was lost. Bring it back.
      id = task.vault_ref.slice(prefix.length)
      if (draft.state.entries[id] || lines.live.has(id) || lines.cancelled.has(id) || lines.frozen.has(id)) continue
    } else {
      continue
    }

    const title = normalizeTitle(task.title)
    if (title === '') {
      draft.skipped.push({ file: draft.ctx.connection.folder, line: null, id: null, reason: `Task ${task.id} has a title that can't be written as line text.` })
      continue
    }
    const fields = fieldsFromApp(task, null)
    out.push({
      id,
      raw: renderNewLine({
        statusChar: statusChar(fields.status),
        title,
        importance: fields.importance,
        due: fields.due,
        done: fields.completed,
        id,
      }),
      op: needsLink
        ? { kind: 'update', taskId: task.id, patch: { vault_ref: vaultRef(name, id) }, action: 'link' }
        : null,
      entryFields: fields,
      taskId: task.id,
      appCompletedAt: task.completed_at,
      title,
    })
  }
  return out
}

/** Only an ordinary file or a file that does not exist yet can take imported lines. */
async function importTargetProblem(vault: string, rel: string, scanned: ScannedFile | undefined): Promise<string | null> {
  const info = await lstat(join(vault, rel)).catch(() => null)
  if (!info) return null
  if (!info.isFile() || !scanned) return `${rel} can't take new lines. It is not a regular UTF-8 file inside the vault.`
  return null
}

function appendLines(existing: string, lines: FileLine[], additions: string[]): string {
  const eol = lines.find((l) => l.eol !== '')?.eol ?? '\n'
  const lead = existing !== '' && !existing.endsWith('\n') ? eol : ''
  return existing + lead + additions.map((raw) => raw + eol).join('')
}

export async function planImports(draft: Draft, lines: ClassifiedLines, tasks: AppTask[], files: ScannedFile[], vault: string, writes: Map<string, FileWrite>): Promise<void> {
  const additions = importsFromApp(draft, lines, tasks)
  if (additions.length === 0) return
  const { folder } = draft.ctx.connection
  const rel = folder === '' ? IMPORT_FILE_NAME : `${folder}/${IMPORT_FILE_NAME}`
  const scanned = files.find((f) => f.rel === rel)
  const problem = await importTargetProblem(vault, rel, scanned)
  const skipAll = (reason: string) => draft.skipped.push({ file: rel, line: null, id: null, reason: `${additions.length} app tasks were not imported. ${reason}` })
  if (problem) return void skipAll(problem)

  const base = writes.get(rel)?.content ?? scanned?.content ?? ''
  const content = appendLines(base, scanned?.lines ?? [], additions.map((a) => a.raw))
  // An open code fence at the end of the file would swallow the new lines.
  const reread = new Set(parseMarkdown(content).flatMap((l) => (l.task?.id ? [l.task.id] : [])))
  if (!additions.every((a) => reread.has(a.id))) {
    return void skipAll(`The end of ${rel} would hide them, most likely inside an open code fence.`)
  }
  writes.set(rel, { rel, expectedHash: scanned?.hash ?? null, content })

  for (const addition of additions) {
    draft.vaultChanges.push({ action: 'import', file: rel, line: null, id: addition.id, before: null, after: addition.raw, fields: [] })
    if (addition.op) {
      draft.appChanges.push({
        action: 'link',
        id: addition.id,
        taskId: addition.taskId,
        title: addition.title,
        fields: { vault_ref: vaultRef(draft.ctx.connection.name, addition.id) },
      })
    }
    draft.items.push({
      id: addition.id,
      file: rel,
      op: addition.op,
      effect: {
        kind: 'upsert',
        file: rel,
        fields: addition.entryFields,
        taskId: addition.op ? null : addition.taskId,
        appCompletedAt: addition.op ? null : addition.appCompletedAt,
      },
    })
  }
}
