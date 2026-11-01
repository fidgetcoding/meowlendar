import { describe, it, expect, afterEach, vi } from 'vitest'
import { bookingRootDomain, bookingSubdomainUrl, classifyHost } from '../hosts'

function configure(appUrl: string, extra: Record<string, string> = {}) {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl)
  vi.stubEnv('BOOKING_ROOT_DOMAIN', '')
  vi.stubEnv('ALLOWED_HOSTS', '')
  vi.stubEnv('VERCEL', '')
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
}

describe('classifyHost', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('treats the configured host, root, and www as the app', () => {
    configure('https://app.example.com')
    for (const host of ['app.example.com', 'example.com', 'www.example.com', 'APP.example.com:443']) {
      expect(classifyHost(host)).toEqual({ kind: 'app' })
    }
  })

  it('treats one valid label under the root as a booking page', () => {
    configure('https://app.example.com')
    expect(classifyHost('nate.example.com')).toEqual({ kind: 'booking', username: 'nate' })
    expect(classifyHost('NATE.example.com:443')).toEqual({ kind: 'booking', username: 'nate' })
  })

  it('uses the app host itself as the root when it has no app. prefix', () => {
    configure('https://calendar.example.com')
    expect(classifyHost('calendar.example.com')).toEqual({ kind: 'app' })
    expect(classifyHost('nate.calendar.example.com')).toEqual({ kind: 'booking', username: 'nate' })
    expect(classifyHost('nate.example.com')).toEqual({ kind: 'rejected' })
  })

  it('honours BOOKING_ROOT_DOMAIN', () => {
    configure('https://calendar.example.com', { BOOKING_ROOT_DOMAIN: 'book.example.org' })
    expect(classifyHost('nate.book.example.org')).toEqual({ kind: 'booking', username: 'nate' })
    expect(classifyHost('calendar.example.com')).toEqual({ kind: 'app' })
  })

  it.each([
    'evil.com',
    'example.com.evil.com',
    'nate.example.com.evil.com',
    'evilexample.com',
    'a.b.example.com',
    '-bad.example.com',
    'bad-.example.com',
    'under_score.example.com',
    '.example.com',
    'admin.example.com',
    'api.example.com',
    '',
  ])('refuses the spoofed host %j', (host) => {
    configure('https://app.example.com')
    expect(classifyHost(host)).toEqual({ kind: 'rejected' })
  })

  it('refuses loopback hosts on a public deployment', () => {
    configure('https://app.example.com')
    expect(classifyHost('localhost:3000')).toEqual({ kind: 'rejected' })
    expect(classifyHost('127.0.0.1:3000')).toEqual({ kind: 'rejected' })
  })

  it('accepts loopback aliases on a local deployment, and nate.localhost', () => {
    configure('http://localhost:3000')
    expect(classifyHost('localhost:3000')).toEqual({ kind: 'app' })
    expect(classifyHost('127.0.0.1:3000')).toEqual({ kind: 'app' })
    expect(classifyHost('nate.localhost:3000')).toEqual({ kind: 'booking', username: 'nate' })
    expect(classifyHost('evil.com:3000')).toEqual({ kind: 'rejected' })
  })

  it('accepts vercel.app only when running on Vercel', () => {
    configure('https://app.example.com')
    expect(classifyHost('preview-1.vercel.app')).toEqual({ kind: 'rejected' })
    configure('https://app.example.com', { VERCEL: '1' })
    expect(classifyHost('preview-1.vercel.app')).toEqual({ kind: 'app' })
  })

  it('accepts hosts named in ALLOWED_HOSTS', () => {
    configure('https://app.example.com', { ALLOWED_HOSTS: 'internal.lan, other.example.net:8443' })
    expect(classifyHost('internal.lan')).toEqual({ kind: 'app' })
    expect(classifyHost('other.example.net')).toEqual({ kind: 'app' })
  })

  it('does not validate, and does no subdomain routing, with no URL configured', () => {
    configure('')
    expect(classifyHost('nate.example.com')).toEqual({ kind: 'app' })
    expect(bookingRootDomain()).toBeNull()
  })
})

describe('bookingSubdomainUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('builds the public URL, with the port when there is one', () => {
    configure('http://localhost:3000')
    expect(bookingSubdomainUrl('nate')).toBe('http://nate.localhost:3000')
    configure('https://app.example.com')
    expect(bookingSubdomainUrl('nate')).toBe('https://nate.example.com')
  })
})
