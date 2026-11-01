import { describe, expect, it } from 'vitest'
import {
  normalizeTitle,
  parseMarkdown,
  parseTaskLine,
  renderMarkdown,
  renderNewLine,
  setDate,
  setId,
  setImportance,
  setStatusChar,
  setTitle,
} from '../../vault/lines.js'

const FULL = '- [ ] text ⏫ 📅 2026-04-15 ⏳ 2026-04-14 🛫 2026-04-13 🔁 every week ✅ 2026-04-16 🆔 abc123'

function parsed(raw: string) {
  const task = parseTaskLine(raw)
  if (!task) throw new Error(`Not a task: ${raw}`)
  return task
}

describe('parseTaskLine', () => {
  it('reads every field of a full line', () => {
    const t = parsed(FULL)
    expect(t).toMatchObject({ title: 'text', status: 'todo', importance: 'high', due: '2026-04-15', done: '2026-04-16', id: 'abc123' })
    expect(t.tokens.map((k) => k.kind)).toEqual(['priority', 'due', 'scheduled', 'start', 'recurrence', 'done', 'id'])
  })

  it.each([
    ['- [ ] a', 'todo'],
    ['- [x] a', 'done'],
    ['- [X] a', 'done'],
    ['- [/] a', 'in_progress'],
    ['- [-] a', 'cancelled'],
    ['- [?] a', 'other'],
  ])('reads the status of %s', (raw, status) => {
    expect(parsed(raw).status).toBe(status)
  })

  it.each(['- [ ] a', '* [ ] a', '+ [ ] a', '1. [ ] a', '    - [ ] a', '\t* [ ] a', '> - [ ] a'])(
    'accepts the list form %s',
    (raw) => {
      expect(parsed(raw).title).toBe('a')
    },
  )

  it.each(['plain text', '- not a task', '- [] nope', '- [ab] nope', '[ ] no bullet', '# - [ ] heading'])(
    'does not treat %s as a task',
    (raw) => {
      expect(parseTaskLine(raw)).toBeNull()
    },
  )

  it('keeps tags out of the title wherever they sit', () => {
    expect(parsed('- [ ] Call #work Bob #home 📅 2026-01-01 #later').title).toBe('Call Bob')
  })

  it('treats an all-digit hash as words', () => {
    expect(parsed('- [ ] Fix bug #123').title).toBe('Fix bug #123')
  })

  it.each([
    ['🔺', 'highest'],
    ['⏫', 'high'],
    ['🔼', 'normal'],
    ['🔽', 'low'],
    ['⏬', 'lowest'],
  ])('maps %s to %s', (symbol, importance) => {
    expect(parsed(`- [ ] a ${symbol}`).importance).toBe(importance)
  })

  it('reads no emoji as normal', () => {
    expect(parsed('- [ ] a').importance).toBe('normal')
  })

  it('reads fields only where the plugin does, at the end of the line', () => {
    const t = parsed('- [ ] Pay 📅 2026-01-01 rent 🔺 now')
    expect(t.due).toBeNull()
    expect(t.importance).toBe('normal')
    expect(t.title).toBe('Pay 📅 2026-01-01 rent 🔺 now')
  })

  it('accepts variation selectors and alternate date symbols', () => {
    const t = parsed('- [ ] a ⏫️ 📆️ 2026-01-02 ⌛ 2026-01-03')
    expect(t).toMatchObject({ importance: 'high', due: '2026-01-02', title: 'a' })
  })

  it.each(['abc123', 'm-1a2b3c4d', 'mw-00000000', '123e4567-e89b-12d3-a456-426614174000', 'WeIrD_id.9'])(
    'takes the id %s as written',
    (id) => {
      expect(parsed(`- [ ] a 🆔 ${id}`).id).toBe(id)
    },
  )

  it('still finds an id stuck in the middle of a line', () => {
    const t = parsed('- [ ] a 🆔 abc more words')
    expect(t.id).toBe('abc')
    expect(t.title).toBe('a more words')
  })

  it('reads through unknown vault-only tokens and a block link', () => {
    const t = parsed('- [ ] a ➕ 2026-01-01 ⛔ x,y 🏁 delete 📅 2026-02-02 ^block-1')
    expect(t).toMatchObject({ title: 'a', due: '2026-02-02' })
  })
})

describe('parseMarkdown and renderMarkdown', () => {
  it.each([
    ['plain', '# Title\n\n- [ ] a 🆔 1\n- [x] b\n\nprose\n'],
    ['no final newline', '- [ ] a'],
    ['empty', ''],
    ['only newlines', '\n\n\n'],
    ['CRLF', '# T\r\n- [ ] a\r\n\r\ntext\r\n'],
    ['mixed endings', 'a\r\nb\nc\r\n'],
    ['BOM', '﻿- [ ] first\n'],
    ['trailing spaces', '- [ ] a   \n- [ ] b\t\n'],
    ['odd spacing', '-   [ ]    a   ⏫    📅   2026-01-01\n'],
    ['alternate symbols', '- [X] a 📆️ 2026-01-01\n'],
    ['unknown tokens', '- [ ] a [custom:: 1] 🧪 x (y) 📅 2026-01-01 %%c%%\n'],
    ['lone CR', 'a\rb\n'],
  ])('round trips byte for byte: %s', (_label, content) => {
    expect(renderMarkdown(parseMarkdown(content))).toBe(content)
  })

  const taskTitles = (content: string) => parseMarkdown(content).flatMap((l) => (l.task ? [l.task.title] : []))

  it('finds no tasks inside code fences', () => {
    const content = [
      '- [ ] before',
      '```',
      '- [ ] fenced',
      '```',
      '~~~~md',
      '- [ ] tilde',
      '~~~',
      '- [ ] still tilde',
      '~~~~',
      '  ```js',
      '  - [ ] indented fence',
      '  ```',
      '> ```',
      '> - [ ] quoted fence',
      '> ```',
      '- [ ] after',
    ].join('\n')
    expect(taskTitles(content)).toEqual(['before', 'after'])
  })

  it('treats an unclosed fence as running to the end of the file', () => {
    expect(taskTitles('- [ ] a\n```\n- [ ] b\n')).toEqual(['a'])
  })

  it('does not open a fence on an inline code run', () => {
    expect(taskTitles('``` not a fence ```\n- [ ] a\n')).toEqual(['a'])
  })

  it('finds no tasks in frontmatter', () => {
    expect(taskTitles('---\nitems:\n- [ ] yaml\n---\n- [ ] body\n')).toEqual(['body'])
  })

  it('reads a first line of --- with no close as a normal line', () => {
    expect(taskTitles('---\n- [ ] body\n')).toEqual(['body'])
  })
})

describe('writers change only their own token', () => {
  it('rewrites the due date in place', () => {
    expect(setDate(FULL, 'due', '2026-09-09')).toBe(FULL.replace('📅 2026-04-15', '📅 2026-09-09'))
  })

  it('keeps an alternate symbol and spacing when rewriting a date', () => {
    expect(setDate('- [ ] a 📆️  2026-01-01 🆔 x', 'due', '2026-02-02')).toBe('- [ ] a 📆️  2026-02-02 🆔 x')
  })

  it('removes a date and its leading space', () => {
    expect(setDate(FULL, 'due', null)).toBe(FULL.replace(' 📅 2026-04-15', ''))
  })

  it('inserts a due date in the format order', () => {
    expect(setDate('- [ ] a ⏫ ⏳ 2026-01-01 🆔 x', 'due', '2026-02-02')).toBe('- [ ] a ⏫ 📅 2026-02-02 ⏳ 2026-01-01 🆔 x')
  })

  it('inserts before a block link and keeps trailing space', () => {
    expect(setDate('- [ ] a ^blk  ', 'due', '2026-02-02')).toBe('- [ ] a 📅 2026-02-02 ^blk  ')
  })

  it('inserts after trailing tags when nothing later is ranked', () => {
    expect(setDate('- [ ] a #t', 'due', '2026-02-02')).toBe('- [ ] a #t 📅 2026-02-02')
  })

  it('replaces the priority emoji', () => {
    expect(setImportance(FULL, 'lowest')).toBe(FULL.replace('⏫', '⏬'))
  })

  it('adds a priority right after the text', () => {
    expect(setImportance('- [ ] a 📅 2026-01-01', 'highest')).toBe('- [ ] a 🔺 📅 2026-01-01')
  })

  it('writing normal removes the emoji', () => {
    expect(setImportance('- [ ] a ⏫ 📅 2026-01-01', 'normal')).toBe('- [ ] a 📅 2026-01-01')
  })

  it('writing normal adds nothing to a bare line', () => {
    expect(setImportance('- [ ] a', 'normal')).toBe('- [ ] a')
  })

  it('writing normal leaves an existing 🔼', () => {
    expect(setImportance('- [ ] a 🔼', 'normal')).toBe('- [ ] a 🔼')
  })

  it('flips the status and nothing else', () => {
    expect(setStatusChar('  * [ ] a #t 🆔 x', '/')).toBe('  * [/] a #t 🆔 x')
  })

  it('adds an id at the end of the fields', () => {
    expect(setId('- [ ] a 📅 2026-01-01 #t', 'mw-1')).toBe('- [ ] a 📅 2026-01-01 #t 🆔 mw-1')
  })

  it('replaces the words and keeps tags and tokens', () => {
    expect(setTitle('- [ ] Call #work Bob ⏫ 🆔 x', 'Ring Robert')).toBe('- [ ] Ring Robert #work ⏫ 🆔 x')
  })

  it('keeps a leading tag separate from the new words', () => {
    expect(setTitle('- [ ] #a Call #b Bob #c', 'New')).toBe('- [ ] #a New #b #c')
  })

  it('keeps indentation, bullet, and spacing', () => {
    expect(setTitle('\t*   [x]  Old  ⏫', 'New')).toBe('\t*   [x]  New  ⏫')
  })

  it('renders a new line in the format order', () => {
    const raw = renderNewLine({ statusChar: 'x', title: 'a', importance: 'high', due: '2026-01-01', done: '2026-01-02', id: 'mw-1' })
    expect(raw).toBe('- [x] a ⏫ 📅 2026-01-01 ✅ 2026-01-02 🆔 mw-1')
  })
})

describe('normalizeTitle', () => {
  it('collapses whitespace and newlines, so a title can not add a line', () => {
    expect(normalizeTitle('a\n- [ ] b\r\n  c')).toBe('a - [ ] b c')
  })

  it.each(['a 🆔 evil', 'a 📅 2026-01-01', 'a #tag', 'a ⏫', 'a ^blk', 'a 🔁 every day'])(
    'strips a field a title tries to smuggle in: %s',
    (title) => {
      expect(normalizeTitle(title)).toBe('a')
    },
  )

  it('settles when stripping a tag exposes a token', () => {
    expect(normalizeTitle('x 📅 #t 2026-01-01')).toBe('x')
  })

  it('returns empty when nothing but tokens remain', () => {
    expect(normalizeTitle('#only 📅 2026-01-01')).toBe('')
  })
})
