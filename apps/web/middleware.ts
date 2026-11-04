import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/middleware'
import { classifyHost } from '@/lib/hosts'

// Paths a booking subdomain serves as they are. Everything else on that host is
// either a booking slug or does not exist, so the app itself never answers there.
function isBookingHostPassthrough(pathname: string): boolean {
  return (
    pathname.startsWith('/api/booking/') ||
    pathname.startsWith('/book/') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/favicon')
  )
}

const SLUG_PATH = /^\/[A-Za-z0-9_-]+$/

export async function middleware(request: NextRequest) {
  const host = classifyHost(request.headers.get('host'))

  if (host.kind === 'rejected') {
    return new NextResponse('Misdirected request', { status: 421 })
  }

  if (host.kind === 'booking') {
    const { pathname } = request.nextUrl
    if (isBookingHostPassthrough(pathname)) return NextResponse.next()

    const url = request.nextUrl.clone()
    if (pathname === '/') {
      url.pathname = `/u/${host.username}`
    } else if (SLUG_PATH.test(pathname)) {
      url.pathname = `/book${pathname}`
    } else {
      return new NextResponse('Not found', { status: 404 })
    }
    const response = NextResponse.rewrite(url)
    response.headers.set('x-booking-username', host.username)
    return response
  }

  const session = createClient(request)
  const { supabase } = session

  // Refresh session on every request
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const response = session.response

  const { pathname } = request.nextUrl

  // Public routes: auth pages, booking pages, API routes, static assets
  const isPublicRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/callback') ||
    pathname.startsWith('/(booking)') ||
    // Path-based booking pages (the /book/{slug} fallback the UI copies) are
    // public — external visitors have no session.
    pathname.startsWith('/book/') ||
    pathname.startsWith('/u/') ||
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

  // Preserve refresh cookies when navigation itself needs a redirect.
  const redirect = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const redirected = NextResponse.redirect(url)
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie)
    return redirected
  }
  if (user && pathname === '/login') return redirect('/')

  if (isPublicRoute || isApiRoute) {
    return response
  }

  // Protected routes: redirect to login if no session
  if (!user) {
    return redirect('/login')
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
