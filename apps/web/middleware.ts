import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/middleware'

/** The host this deployment serves the app on, from NEXT_PUBLIC_APP_URL. */
function configuredAppHost(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').hostname.toLowerCase()
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  // Strip the port before any host analysis. Leaving it on made `localhost:3000`
  // need a startsWith hack, and it never saved `127.0.0.1:3000` at all — the
  // IP's own dots satisfied the old `hostname.includes('.')` test, so every
  // loopback-by-IP request was misread as a booking subdomain and rewritten
  // into a 404. Playwright targets 127.0.0.1, so that took the whole E2E suite
  // down with it.
  const host = (hostname.split(':')[0] ?? '').toLowerCase()
  const labels = host.split('.')
  const subdomain = labels[0] ?? ''

  // An IP literal is a host, never a booking namespace.
  const isIpLiteral = /^\d+(\.\d+)*$/.test(host)
  // A booking namespace needs an actual subdomain label in front of a
  // registrable domain: `nate.poolendar.com` yes, `poolendar.com` and bare
  // `localhost` no. `nate.localhost` is allowed so subdomains stay testable
  // locally.
  const hasSubdomainLabel =
    labels.length > 2 || (labels.length === 2 && labels[1] === 'localhost')

  // A self-hosted app on `calendar.example.com` or `my-app.vercel.app` has three
  // labels too, and must not be swallowed by the booking rewrite below.
  const isDeploymentHost = host === configuredAppHost() || host.endsWith('.vercel.app')

  // Subdomain routing for booking pages
  // If subdomain is not the app itself, treat it as a booking page namespace
  const isBookingSubdomain =
    !isIpLiteral &&
    !isDeploymentHost &&
    hasSubdomainLabel &&
    subdomain !== 'app' &&
    subdomain !== 'www' &&
    subdomain !== 'poolendar'

  if (isBookingSubdomain) {
    const url = request.nextUrl.clone()
    const bookingPath = url.pathname === '/' ? '' : url.pathname
    url.pathname = `/(booking)${bookingPath}`
    const response = NextResponse.rewrite(url)
    response.headers.set('x-booking-username', subdomain)
    return response
  }

  const { supabase, response } = createClient(request)

  // Refresh session on every request
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes: auth pages, booking pages, API routes, static assets
  const isPublicRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/callback') ||
    pathname.startsWith('/(booking)') ||
    // Path-based booking pages (the /book/{slug} fallback the UI copies) are
    // public — external visitors have no session.
    pathname.startsWith('/book/') ||
    pathname.startsWith('/api/booking/availability') ||
    pathname.startsWith('/api/booking/book') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    // PWA assets must load without a session: the browser fetches them
    // credential-less, and a redirect to /login breaks SW registration.
    pathname === '/manifest.json' ||
    pathname === '/sw.js'

  // API routes get their own auth handling via the authenticate() helper
  const isApiRoute = pathname.startsWith('/api/')

  if (isPublicRoute || isApiRoute) {
    return response
  }

  // Protected routes: redirect to login if no session
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Authenticated user visiting /login — redirect to app
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
