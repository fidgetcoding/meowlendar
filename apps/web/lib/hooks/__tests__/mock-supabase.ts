import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Chainable Supabase query builder mock
// ---------------------------------------------------------------------------
// Every Supabase PostgREST method returns the builder itself so calls can
// be chained:  supabase.from('x').select('*').eq('id', '1').single()
//
// The final call in every chain is either awaited (returns { data, error })
// or chained further.  We use a Proxy so ANY property access returns a
// function that returns the same builder, and the builder is also a thenable
// that resolves to { data, error }.
//
// Result strategy:
//   - A result queue is checked first (FIFO). Use `mockSupabaseResults()`
//     for multi-step mutations that make several Supabase calls.
//   - When the queue is empty, the "sticky" result is used. This stays
//     set until explicitly changed, so single-call hooks work with just
//     `mockSupabaseResult()`.
// ---------------------------------------------------------------------------

export type MockResult = { data: unknown; error: unknown }

let stickyResult: MockResult = { data: null, error: null }
let resultQueue: MockResult[] = []

/**
 * Set a sticky result. It persists across all subsequent awaits until changed.
 * For hooks that make a single Supabase call, this is all you need.
 */
export function mockSupabaseResult(data: unknown, error: unknown = null) {
  stickyResult = { data, error }
  resultQueue = []
}

/**
 * Set an error as the sticky result.
 */
export function mockSupabaseError(error: unknown) {
  stickyResult = { data: null, error }
  resultQueue = []
}

/**
 * Queue multiple results for multi-step mutations.
 * Each `await` on a query builder pops the next result from the queue.
 * Once the queue is empty, the last result stays sticky.
 */
export function mockSupabaseResults(...results: MockResult[]) {
  if (results.length === 0) return
  resultQueue = [...results]
  stickyResult = results[results.length - 1]!
}

function dequeueResult(): MockResult {
  if (resultQueue.length > 0) {
    return resultQueue.shift()!
  }
  return { ...stickyResult }
}

/** Every property is a chainable method; awaiting the builder yields a MockResult. */
type MockQueryBuilder = PromiseLike<MockResult> & Record<string, unknown>

function createQueryBuilder(): MockQueryBuilder {
  const builder: MockQueryBuilder = new Proxy(
    {} as MockQueryBuilder,
    {
      get(_target, prop) {
        // Make the builder thenable so `await supabase.from(...).select(...)` works
        if (prop === 'then') {
          return (resolve: (val: MockResult) => void) => {
            const result = dequeueResult()
            return Promise.resolve(result).then(resolve)
          }
        }
        // Any method call returns the builder itself for chaining
        return vi.fn(() => builder)
      },
    },
  )
  return builder
}

// The Supabase auth mock
const mockAuth = {
  getUser: vi.fn().mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
    error: null,
  }),
}

/**
 * The mock Supabase client object.
 * `from()` returns a chainable query builder; auth.getUser() returns a user.
 */
export const mockSupabaseClient = {
  from: vi.fn(() => createQueryBuilder()),
  auth: mockAuth,
}

/**
 * Reset all Supabase mocks between tests.
 */
export function resetSupabaseMocks() {
  stickyResult = { data: null, error: null }
  resultQueue = []
  mockSupabaseClient.from.mockClear()
  mockSupabaseClient.from.mockImplementation(() => createQueryBuilder())
  mockAuth.getUser.mockClear()
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
    error: null,
  })
}

// ---------------------------------------------------------------------------
// Module mock — replaces @/lib/supabase/client
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabaseClient,
}))
