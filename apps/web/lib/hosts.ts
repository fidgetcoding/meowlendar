// Decides what a request's Host header means. Runs in middleware and in the public
// booking routes, so it stays free of Node-only imports.
//
// A Host header is whatever the client sends. Anything not derived from the
// deployment's own configuration is refused rather than trusted.

export type HostKind =
  | { kind: 'app' }
  | { kind: 'booking'; username: string }
  | { kind: 'rejected' }

// Labels a user must not be able to claim as a booking page.
const RESERVED_LABELS = new Set(['app', 'www', 'api', 'admin', 'mail', 'static', 'assets', 'cdn', 'status'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LABEL_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function stripPort(host: string): string {
  const lower = host.trim().toLowerCase()
  if (lower.startsWith('[')) return lower.slice(0, lower.indexOf(']') + 1)
  return lower.split(':')[0] ?? ''
}

function configuredAppHost(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The domain booking subdomains hang off. Defaults to the app's own host. */
export function bookingRootDomain(): string | null {
  const configured = process.env.BOOKING_ROOT_DOMAIN?.trim().toLowerCase()
  if (configured) return configured
  const appHost = configuredAppHost()
  if (!appHost) return null
  return appHost.replace(/^(app|www)\./, '')
}

function extraAllowedHosts(): string[] {
  return (process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => stripPort(h))
    .filter(Boolean)
}

export function classifyHost(rawHost: string | null | undefined): HostKind {
  const appHost = configuredAppHost()
  // Without a configured URL there is nothing to validate against, and subdomain
  // routing stays off. DEPLOY.md makes NEXT_PUBLIC_APP_URL a required setting.
  if (!appHost) return { kind: 'app' }

  const host = stripPort(rawHost ?? '')
  if (!host) return { kind: 'rejected' }

  const root = bookingRootDomain() as string
  if (host === appHost || host === root || host === `www.${root}`) return { kind: 'app' }
  if (extraAllowedHosts().includes(host)) return { kind: 'app' }
  // Loopback only counts when this is a local deployment, so a request can't pass
  // as local by sending `Host: localhost` to a public server.
  if (LOOPBACK_HOSTS.has(appHost) && LOOPBACK_HOSTS.has(host)) return { kind: 'app' }
  if (process.env.VERCEL && host.endsWith('.vercel.app')) return { kind: 'app' }

  const suffix = `.${root}`
  if (host.endsWith(suffix)) {
    const label = host.slice(0, -suffix.length)
    if (LABEL_SHAPE.test(label) && !RESERVED_LABELS.has(label)) {
      return { kind: 'booking', username: label }
    }
  }
  return { kind: 'rejected' }
}

/** The base URL of someone's booking page, for display. */
export function bookingSubdomainUrl(username: string): string | null {
  const root = bookingRootDomain()
  if (!root || root.includes('127.0.0.1')) return null
  try {
    const app = new URL(process.env.NEXT_PUBLIC_APP_URL ?? '')
    return `${app.protocol}//${username}.${root}${app.port ? `:${app.port}` : ''}`
  } catch {
    return null
  }
}
