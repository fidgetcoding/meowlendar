import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { clientIp } from '../client-ip'

function request(headers: Record<string, string>) {
  return new NextRequest('https://app.example.com/api/booking/book/x', { headers })
}

describe('clientIp', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('ignores a client-supplied x-forwarded-for when no header is trusted', () => {
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('TRUSTED_IP_HEADER', '')
    expect(clientIp(request({ 'x-forwarded-for': '1.2.3.4' }))).toBe('untrusted')
  })

  it('reads the configured header and takes the entry the proxy appended', () => {
    vi.stubEnv('TRUSTED_IP_HEADER', 'X-Forwarded-For')
    expect(clientIp(request({ 'x-forwarded-for': 'spoofed, 5.6.7.8' }))).toBe('5.6.7.8')
  })

  it('uses the platform header on Vercel', () => {
    vi.stubEnv('TRUSTED_IP_HEADER', '')
    vi.stubEnv('VERCEL', '1')
    expect(
      clientIp(request({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': 'spoofed' })),
    ).toBe('9.9.9.9')
  })

  it('falls back to the shared bucket when the trusted header is absent', () => {
    vi.stubEnv('TRUSTED_IP_HEADER', 'x-real-ip')
    expect(clientIp(request({}))).toBe('untrusted')
  })
})
