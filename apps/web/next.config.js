const isDev = process.env.NODE_ENV === 'development'

// Security headers live here, not in vercel.json, so every host gets them.
// Read at build time: rebuild after changing NEXT_PUBLIC_SUPABASE_URL.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseWs = supabaseUrl.replace(/^http/, 'ws')

// 'unsafe-inline' is required for scripts because Next's inline bootstrap has no
// nonce here. The rest of the policy still limits where data can go.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // https: because hosts can set their own avatar and booking page logo.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs}${isDev ? ' ws:' : ''}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
]

// Only the public booking endpoints are callable from other sites. The rest of
// the API is same-origin or called by servers, which don't use CORS.
const publicApiHeaders = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
  { key: 'Access-Control-Max-Age', value: '86400' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@poolendar/types', '@poolendar/validators', '@poolendar/api-client'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/api/booking/availability/:path*', headers: publicApiHeaders },
      { source: '/api/booking/book/:path*', headers: publicApiHeaders },
      { source: '/api/booking/cancel', headers: publicApiHeaders },
    ]
  },
}

module.exports = nextConfig
