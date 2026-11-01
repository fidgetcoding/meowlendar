import { describe, it, expect } from 'vitest'
import * as validators from '../index'

const updateSchemas = Object.entries(validators).filter(
  ([name, value]) =>
    /^update.*Schema$/.test(name) && typeof (value as { safeParse?: unknown }).safeParse === 'function',
) as [string, { parse: (input: unknown) => unknown }][]

describe('update schemas', () => {
  it('finds the update schemas', () => {
    expect(updateSchemas.length).toBeGreaterThanOrEqual(5)
  })

  it.each(updateSchemas)('%s adds no defaults to a PATCH body', (_name, schema) => {
    expect(schema.parse({})).toEqual({})
  })

  it('keeps only what the caller sent', () => {
    expect(validators.updateTaskSchema.parse({ title: 'renamed' })).toEqual({ title: 'renamed' })
  })
})
