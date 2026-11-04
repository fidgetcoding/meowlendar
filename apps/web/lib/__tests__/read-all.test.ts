import { expect, it } from 'vitest'
import { readAll } from '../read-all'
it('reads every server page even when its row cap is below the requested page size', async () => {
  const rows = Array.from({ length: 1207 }, (_, id) => ({ id }))
  let start = 0
  const query = {
    range(from: number) { start = from; return query },
    then<T>(resolve: (value: { data: { id: number }[]; error: null }) => T) { return Promise.resolve({ data: rows.slice(start, start + 137), error: null }).then(resolve) },
  }
  expect((await readAll(query)).data).toEqual(rows)
})

it('reports a later-page failure without returning a silently partial list', async () => {
  const error = { message: 'Second page unavailable' }
  let offset = 0
  const query = {
    range(from: number) { offset = from; return query },
    then<T>(resolve: (value: { data: { id: number }[] | null; error: typeof error | null }) => T) {
      return Promise.resolve(offset ? { data: null, error } : { data: [{ id: 1 }], error: null }).then(resolve)
    },
  }
  expect(await readAll(query)).toEqual({ data: null, error })
})
