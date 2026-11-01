import { describe, it, expect } from 'vitest'
import { validateArgs } from '../validate.js'
import { getTaskToolDefinitions } from '../tools/index.js'

const deleteTask = getTaskToolDefinitions().find((t) => t.name === 'delete_task')!.inputSchema
const createTask = getTaskToolDefinitions().find((t) => t.name === 'create_task')!.inputSchema

describe('validateArgs', () => {
  it('accepts valid arguments', () => {
    expect(validateArgs({ id: '8c1e6dec-3b7f-4e13-ae40-1a714db8b408' }, deleteTask)).toEqual([])
    expect(validateArgs({ title: 'x', importance: 'high' }, createTask)).toEqual([])
  })

  it('rejects an argument the tool does not declare', () => {
    expect(validateArgs({ id: 'abc', vault_ref: 'evil:line' }, deleteTask)).toEqual([
      'vault_ref is not an accepted argument',
    ])
  })

  it('rejects a path traversal id', () => {
    expect(validateArgs({ id: '../api-keys/abc' }, deleteTask)).toEqual(['id is not a valid id'])
    expect(validateArgs({ id: '..' }, deleteTask)).toEqual(['id is not a valid id'])
  })

  it('rejects a missing required field, a wrong type, and a bad enum', () => {
    expect(validateArgs({}, deleteTask)).toEqual(['id is required'])
    expect(validateArgs({ id: 42 }, deleteTask)).toEqual(['id must be string'])
    expect(validateArgs({ title: 'x', importance: 'urgent' }, createTask)[0]).toContain(
      'importance must be one of',
    )
  })
})
