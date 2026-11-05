import * as React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.stubGlobal('React', React)
let emit: (event: string) => void = () => {}
const unsubscribe = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        emit = cb
        return { data: { subscription: { unsubscribe } } }
      },
    },
  }),
}))

import { AuthCacheSync } from '../AuthCacheSync'

afterEach(cleanup)

function mount() {
  const client = new QueryClient()
  render(<QueryClientProvider client={client}><AuthCacheSync /></QueryClientProvider>)
  return client
}

it('refetches everything when someone signs in', () => {
  const client = mount()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  emit('SIGNED_IN')
  expect(invalidate).toHaveBeenCalledWith()
})

it('drops the cache when someone signs out, and ignores token refreshes', () => {
  const client = mount()
  client.setQueryData(['tasks', 'list', {}], [{ id: 't1' }])
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  emit('TOKEN_REFRESHED')
  expect(invalidate).not.toHaveBeenCalled()
  expect(client.getQueryData(['tasks', 'list', {}])).toBeTruthy()
  emit('SIGNED_OUT')
  expect(client.getQueryData(['tasks', 'list', {}])).toBeUndefined()
})
