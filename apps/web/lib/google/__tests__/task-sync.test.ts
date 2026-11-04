import { describe, expect, it } from 'vitest'
import { googleEventIdForTask } from '../task-sync'

describe('Google task IDs', () => {
  it('uses the Google base32hex alphabet for stable per-task IDs', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const result = googleEventIdForTask(id)
    expect(result).toMatch(/^[a-v0-9]{5,1024}$/)
    expect(googleEventIdForTask(id.toUpperCase())).toBe(result)
    expect(googleEventIdForTask('00000000-0000-4000-8000-000000000002')).not.toBe(result)
  })
})
