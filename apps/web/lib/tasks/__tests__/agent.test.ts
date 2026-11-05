import { describe, expect, it } from 'vitest'
import { isAgentTask } from '../agent'

describe('isAgentTask', () => {
  it("is true only for tasks created through the API", () => {
    expect(isAgentTask({ created_via: 'api' })).toBe(true)
  })

  it.each([
    ['made in the app', { created_via: 'app' as const }],
    ['made before the origin was recorded', { created_via: null }],
    ['read without the column', {}],
  ])('is false for a task %s', (_label, task) => {
    expect(isAgentTask(task)).toBe(false)
  })

  it('is false when there is no task', () => {
    expect(isAgentTask(null)).toBe(false)
    expect(isAgentTask(undefined)).toBe(false)
  })
})
