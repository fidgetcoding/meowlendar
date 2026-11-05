import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../route'

describe('GET /api/demo-available', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is true where local setup made the demo account', async () => {
    vi.stubEnv('DEMO_ACCOUNT', '1')
    const res = GET()
    expect(await res.json()).toEqual({ available: true })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([undefined, '0', 'true', ''])('is false otherwise (DEMO_ACCOUNT=%s), as on a hosted deploy', async (value) => {
    if (value === undefined) vi.stubEnv('DEMO_ACCOUNT', undefined as unknown as string)
    else vi.stubEnv('DEMO_ACCOUNT', value)
    expect(await GET().json()).toEqual({ available: false })
  })
})
