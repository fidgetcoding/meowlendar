import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '../safe-path'

describe('safeInternalPath', () => {
  it.each(['/', '/settings', '/book/30min?x=1'])('accepts %s', (value) => {
    expect(safeInternalPath(value)).toBe(value)
  })

  it.each([
    '.evil.com',
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ])('rejects %s', (value) => {
    expect(safeInternalPath(value)).toBeNull()
  })
})
