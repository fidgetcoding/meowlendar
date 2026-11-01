// Parser and writer for Obsidian Tasks lines. It reads a line the way the
// Obsidian Tasks plugin does: fields count only in the run of tokens at the end
// of the line, so "Pay 📅 2026-01-01 rent" has no due date. Every edit splices the
// one token that changed into the original string, so everything else on the line
// keeps its exact bytes.
import type { Importance } from './types.js'

export type DateKind = 'due' | 'scheduled' | 'start' | 'created' | 'done' | 'cancelled'
export type TokenKind =
  | DateKind
  | 'priority'
  | 'recurrence'
  | 'id'
  | 'dependsOn'
  | 'onCompletion'
  | 'tag'
  | 'block'

export interface LineToken {
  kind: TokenKind
  start: number
  end: number
  valueStart: number
  value: string
}

export type LineStatus = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'other'

export interface ParsedTask {
  raw: string
  statusChar: string
  status: LineStatus
  statusOffset: number
  bodyStart: number
  textEnd: number
  tokens: LineToken[]
  title: string
  id: string | null
  importance: Importance
  due: string | null
  done: string | null
}

export interface FileLine {
  index: number
  raw: string
  eol: string
  task: ParsedTask | null
}

const TASK_LINE = /^(﻿?[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[)(.)(\][ \t]*)(.*)$/u
const FENCE = /^[ \t>]*(`{3,}|~{3,})(.*)$/u
const VS = '\\uFE0F?'
const GAP = '[ \\t]*'
const DATE = '(\\d{4}-\\d{2}-\\d{2})'

const DATE_SYMBOLS: Record<DateKind, string> = {
  due: '📅📆🗓',
  scheduled: '⏳⌛',
  start: '🛫',
  created: '➕',
  done: '✅',
  cancelled: '❌',
}

const PRIORITY_BY_SYMBOL: Record<string, Importance> = {
  '🔺': 'highest',
  '⏫': 'high',
  '🔼': 'normal',
  '🔽': 'low',
  '⏬': 'lowest',
}

const SYMBOL_BY_PRIORITY: Record<Importance, string> = {
  highest: '🔺',
  high: '⏫',
  normal: '🔼',
  low: '🔽',
  lowest: '⏬',
}

const TAG_BODY = '#[^ \\t!@#$%^&*(),.?":{}|<>]+'

interface TrailingMatcher {
  kind: TokenKind
  regex: RegExp
}

// Tried in this order against the text before the last token found. Anchored at
// the end, so only the token that closes the slice can match.
const TRAILING: TrailingMatcher[] = [
  { kind: 'priority', regex: new RegExp(`()([🔺⏫🔼🔽⏬]${VS})$`, 'u') },
  ...(Object.keys(DATE_SYMBOLS) as DateKind[]).map((kind) => ({
    kind,
    regex: new RegExp(`()[${DATE_SYMBOLS[kind]}]${VS}${GAP}${DATE}$`, 'u'),
  })),
  { kind: 'recurrence', regex: new RegExp(`()🔁${VS}${GAP}([a-zA-Z0-9, !]+)$`, 'iu') },
  {
    kind: 'dependsOn',
    regex: new RegExp(`()⛔${VS}${GAP}([a-zA-Z0-9_-]+(?:${GAP},${GAP}[a-zA-Z0-9_-]+)*)$`, 'u'),
  },
  { kind: 'onCompletion', regex: new RegExp(`()🏁${VS}${GAP}([a-zA-Z]+)$`, 'u') },
  { kind: 'id', regex: new RegExp(`()🆔${VS}${GAP}(\\S+)$`, 'u') },
  { kind: 'tag', regex: new RegExp(`(^|[ \\t])(${TAG_BODY})$`, 'u') },
]

const BLOCK_LINK = /(^|[ \t])(\^[a-zA-Z0-9-]+)$/u
const INLINE_TAG = new RegExp(`(^|[ \\t])(${TAG_BODY})`, 'gu')
const INLINE_ID = new RegExp(`🆔${VS}${GAP}(\\S+)`, 'u')

function isTagText(value: string): boolean {
  // Obsidian does not treat an all-digit word as a tag, and "#123" is usually an issue number.
  return !/^#\d+$/.test(value)
}

function matchTrailing(slice: string, first: boolean): Omit<LineToken, 'valueStart'> | null {
  const matchers: TrailingMatcher[] = first
    ? [{ kind: 'block', regex: BLOCK_LINK }, ...TRAILING]
    : TRAILING
  for (const { kind, regex } of matchers) {
    const m = regex.exec(slice)
    if (!m) continue
    const value = m[2] ?? ''
    if (kind === 'tag' && !isTagText(value)) continue
    return { kind, start: m.index + (m[1]?.length ?? 0), end: slice.length, value }
  }
  return null
}

function scanTrailing(raw: string, bodyStart: number): { tokens: LineToken[]; textEnd: number } {
  const tokens: LineToken[] = []
  let end = raw.length
  for (;;) {
    let trimmed = end
    while (trimmed > bodyStart && (raw[trimmed - 1] === ' ' || raw[trimmed - 1] === '\t')) trimmed--
    const found = matchTrailing(raw.slice(bodyStart, trimmed), tokens.length === 0)
    if (!found) return { tokens: tokens.reverse(), textEnd: trimmed }
    const start = bodyStart + found.start
    const tokenEnd = bodyStart + found.end
    tokens.push({
      kind: found.kind,
      start,
      end: tokenEnd,
      value: found.value,
      valueStart: tokenEnd - found.value.length,
    })
    end = start
  }
}

function scanText(raw: string, bodyStart: number, textEnd: number, hasId: boolean): LineToken[] {
  const text = raw.slice(bodyStart, textEnd)
  const tokens: LineToken[] = []
  // A 🆔 stuck in the middle of a line is still that line's stable id.
  const idMatch = hasId ? null : INLINE_ID.exec(text)
  if (idMatch) {
    const start = bodyStart + idMatch.index
    const end = start + idMatch[0].length
    tokens.push({ kind: 'id', start, end, value: idMatch[1] ?? '', valueStart: end - (idMatch[1] ?? '').length })
  }
  for (const m of text.matchAll(INLINE_TAG)) {
    const value = m[2] ?? ''
    if (!isTagText(value)) continue
    const start = bodyStart + (m.index ?? 0) + (m[1]?.length ?? 0)
    const end = start + value.length
    if (tokens.some((t) => t.kind === 'id' && start < t.end && end > t.start)) continue
    tokens.push({ kind: 'tag', start, end, value, valueStart: start })
  }
  return tokens.sort((a, b) => a.start - b.start)
}

function textRuns(raw: string, bodyStart: number, textEnd: number, tokens: LineToken[]): string[] {
  const runs: string[] = []
  let pos = bodyStart
  for (const token of tokens) {
    if (token.start >= textEnd) break
    runs.push(raw.slice(pos, token.start))
    pos = token.end
  }
  runs.push(raw.slice(pos, textEnd))
  return runs
}

interface Structure {
  statusChar: string
  statusOffset: number
  bodyStart: number
  textEnd: number
  tokens: LineToken[]
  rawTitle: string
}

function parseStructure(raw: string): Structure | null {
  const m = TASK_LINE.exec(raw)
  if (!m) return null
  const prefix = m[1] ?? ''
  const statusChar = m[2] ?? ' '
  const bodyStart = prefix.length + statusChar.length + (m[3] ?? '').length
  const trailing = scanTrailing(raw, bodyStart)
  const hasId = trailing.tokens.some((t) => t.kind === 'id')
  const inText = scanText(raw, bodyStart, trailing.textEnd, hasId)
  const tokens = [...inText, ...trailing.tokens]
  return {
    statusChar,
    statusOffset: prefix.length,
    bodyStart,
    textEnd: trailing.textEnd,
    tokens,
    rawTitle: collapse(textRuns(raw, bodyStart, trailing.textEnd, inText).join('')),
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * The title a line would read back as if this text were its description. Stripping
 * tags and tokens can expose another token, so repeat until it settles. App titles
 * go through this too, which is why a title can never smuggle a field onto a line.
 */
export function normalizeTitle(text: string): string {
  let current = collapse(text)
  for (let i = 0; i < 8; i++) {
    const next = parseStructure(`- [ ] ${current}`)?.rawTitle ?? ''
    if (next === current) return current
    current = next
  }
  return current
}

function statusOf(char: string): LineStatus {
  if (char === ' ') return 'todo'
  if (char === '/') return 'in_progress'
  if (char === 'x' || char === 'X') return 'done'
  if (char === '-') return 'cancelled'
  return 'other'
}

function lastToken(tokens: LineToken[], kind: TokenKind): LineToken | null {
  return tokens.filter((t) => t.kind === kind).at(-1) ?? null
}

export function parseTaskLine(raw: string): ParsedTask | null {
  const s = parseStructure(raw)
  if (!s) return null
  const priority = lastToken(s.tokens, 'priority')
  const symbol = priority?.value.replace('️', '') ?? ''
  return {
    raw,
    statusChar: s.statusChar,
    status: statusOf(s.statusChar),
    statusOffset: s.statusOffset,
    bodyStart: s.bodyStart,
    textEnd: s.textEnd,
    tokens: s.tokens,
    title: normalizeTitle(s.rawTitle),
    id: lastToken(s.tokens, 'id')?.value ?? null,
    importance: PRIORITY_BY_SYMBOL[symbol] ?? 'normal',
    due: lastToken(s.tokens, 'due')?.value ?? null,
    done: lastToken(s.tokens, 'done')?.value ?? null,
  }
}

/** Frontmatter spans from a first line of --- to the next --- or ..., when there is one. */
function frontmatterEnd(rawLines: string[]): number {
  if ((rawLines[0] ?? '').replace('﻿', '').trimEnd() !== '---') return 0
  for (let i = 1; i < rawLines.length; i++) {
    const line = (rawLines[i] ?? '').trimEnd()
    if (line === '---' || line === '...') return i + 1
  }
  return 0
}

/** Splits a file into lines with their exact endings. Joining them gives the file back byte for byte. */
export function parseMarkdown(content: string): FileLine[] {
  const pieces = content.split(/(\r\n|\n)/)
  const rawLines: string[] = []
  const eols: string[] = []
  for (let i = 0; i < pieces.length; i += 2) {
    rawLines.push(pieces[i] ?? '')
    eols.push(pieces[i + 1] ?? '')
  }
  // A file ending in a newline splits into a trailing empty piece that is not a line.
  if (rawLines.at(-1) === '' && eols.at(-1) === '') {
    rawLines.pop()
    eols.pop()
  }

  const skipUntil = frontmatterEnd(rawLines)
  let fence: { char: string; length: number } | null = null
  return rawLines.map((raw, index) => {
    const line: FileLine = { index, raw, eol: eols[index] ?? '', task: null }
    if (index < skipUntil) return line
    const m = FENCE.exec(raw)
    const run = m?.[1] ?? ''
    const rest = m?.[2] ?? ''
    if (fence) {
      if (run[0] === fence.char && run.length >= fence.length && rest.trim() === '') fence = null
      return line
    }
    if (m && !(run[0] === '`' && rest.includes('`'))) {
      fence = { char: run[0] ?? '`', length: run.length }
      return line
    }
    line.task = parseTaskLine(raw)
    return line
  })
}

export function renderMarkdown(lines: { raw: string; eol: string }[]): string {
  return lines.map((l) => l.raw + l.eol).join('')
}

function requireTask(raw: string): ParsedTask {
  const parsed = parseTaskLine(raw)
  if (!parsed) throw new Error('Not a task line')
  return parsed
}

function splice(raw: string, start: number, end: number, text: string): string {
  return raw.slice(0, start) + text + raw.slice(end)
}

export function setStatusChar(raw: string, char: string): string {
  const p = requireTask(raw)
  return splice(raw, p.statusOffset, p.statusOffset + p.statusChar.length, char)
}

// Where a new field goes, matching the order in the format's example line.
const INSERT_RANK: Partial<Record<TokenKind, number>> = {
  priority: 1,
  due: 2,
  scheduled: 3,
  start: 4,
  recurrence: 5,
  done: 6,
  cancelled: 7,
  id: 8,
}

function insertField(p: ParsedTask, kind: TokenKind, text: string): string {
  const rank = INSERT_RANK[kind] ?? 99
  const trailing = p.tokens.filter((t) => t.start >= p.textEnd)
  const next = trailing.find((t) => (INSERT_RANK[t.kind] ?? 0) > rank)
  if (next) return splice(p.raw, next.start, next.start, `${text} `)
  const content = trailing.filter((t) => t.kind !== 'block').at(-1)
  const at = content ? content.end : p.textEnd
  return splice(p.raw, at, at, ` ${text}`)
}

function removeToken(raw: string, token: LineToken, bodyStart: number): string {
  let start = token.start
  while (start > bodyStart && (raw[start - 1] === ' ' || raw[start - 1] === '\t')) start--
  return splice(raw, start, token.end, '')
}

const CANONICAL_DATE_SYMBOL: Record<DateKind, string> = {
  due: '📅',
  scheduled: '⏳',
  start: '🛫',
  created: '➕',
  done: '✅',
  cancelled: '❌',
}

export function setDate(raw: string, kind: DateKind, value: string | null): string {
  const p = requireTask(raw)
  const token = lastToken(p.tokens, kind)
  if (token) {
    if (value === null) return removeToken(raw, token, p.bodyStart)
    return splice(raw, token.valueStart, token.end, value)
  }
  if (value === null) return raw
  return insertField(p, kind, `${CANONICAL_DATE_SYMBOL[kind]} ${value}`)
}

/** Normal is the absence of an emoji, so it never adds one and leaves an existing 🔼 alone. */
export function setImportance(raw: string, importance: Importance): string {
  const p = requireTask(raw)
  const token = lastToken(p.tokens, 'priority')
  if (importance === 'normal') {
    if (!token || token.value.startsWith('🔼')) return raw
    return removeToken(raw, token, p.bodyStart)
  }
  const symbol = SYMBOL_BY_PRIORITY[importance]
  if (token) return splice(raw, token.start, token.end, symbol)
  return insertField(p, 'priority', symbol)
}

export function setId(raw: string, id: string): string {
  const p = requireTask(raw)
  return insertField(p, 'id', `🆔 ${id}`)
}

/** Replaces the words of the description. Tags and every other token stay where they are. */
export function setTitle(raw: string, title: string): string {
  const p = requireTask(raw)
  const inText = p.tokens.filter((t) => t.start < p.textEnd)
  let out = ''
  let placed = false
  let pos = p.bodyStart
  const writeRun = (run: string, followedByToken: boolean) => {
    if (run.trim() === '') {
      out += run
    } else if (!placed) {
      const leading = run.slice(0, run.length - run.trimStart().length)
      const trailing = run.slice(run.trimEnd().length)
      out += leading + title + trailing
      placed = true
    } else if (followedByToken) {
      out += ' '
    }
  }
  for (const token of inText) {
    writeRun(raw.slice(pos, token.start), true)
    out += raw.slice(token.start, token.end)
    pos = token.end
  }
  writeRun(raw.slice(pos, p.textEnd), false)
  if (!placed) out = `${title} ${out}`
  return raw.slice(0, p.bodyStart) + out + raw.slice(p.textEnd)
}

/** A brand new line for a task that came from the app. */
export function renderNewLine(options: {
  statusChar: string
  title: string
  importance: Importance
  due: string | null
  done: string | null
  id: string
}): string {
  let raw = `- [${options.statusChar}] ${options.title}`
  raw = setImportance(raw, options.importance)
  raw = setDate(raw, 'due', options.due)
  raw = setDate(raw, 'done', options.done)
  return setId(raw, options.id)
}
