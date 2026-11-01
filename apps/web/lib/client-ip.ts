import type { NextRequest } from 'next/server'

const warned = { untrusted: false }

/** Header set by the platform in front of the app. A client can't forge it. */
function trustedHeader(): string | null {
  const configured = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase()
  if (configured) return configured
  return process.env.VERCEL ? 'x-vercel-forwarded-for' : null
}

/**
 * The caller's IP for rate limiting. Only a header named by the deployment is
 * believed, because a client can send any x-forwarded-for it likes. With none
 * configured, every caller shares one bucket: stricter, but not bypassable.
 * The rightmost entry is the one the trusted proxy appended.
 */
export function clientIp(request: NextRequest): string {
  const header = trustedHeader()
  const value = header ? request.headers.get(header) : null
  const ip = value?.split(',').pop()?.trim()
  if (ip) return ip

  if (!warned.untrusted && process.env.NODE_ENV === 'production') {
    warned.untrusted = true
    console.warn(
      '[client-ip] No trusted client IP header. All public booking requests share one rate-limit bucket. ' +
        'Set TRUSTED_IP_HEADER to the header your proxy sets.',
    )
  }
  return 'untrusted'
}
