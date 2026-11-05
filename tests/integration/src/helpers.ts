import { createHash, randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const APP = process.env.MEOW_APP_URL ?? 'http://localhost:3210'
export const CRON_SECRET = process.env.MEOW_CRON_SECRET ?? ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const FAKES = 'http://127.0.0.1:4105'

const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }

export function publicClient(): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLIC_KEY, authOptions)
}

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', authOptions)
}

export interface TestUser {
  id: string
  email: string
  password: string
  client: SupabaseClient
  apiKey: string
  keyId: string
  /** Calls the app with this user's API key. */
  api: (path: string, init?: RequestInit) => Promise<Response>
}

let counter = 0

export async function createUser(prefix = 'user'): Promise<TestUser> {
  const client = publicClient()
  const email = `${prefix}-${Date.now().toString(36)}-${++counter}@example.com`
  const password = randomBytes(12).toString('hex')
  const { data, error } = await client.auth.signUp({ email, password })
  if (error || !data.user) throw error ?? new Error('sign-up failed')

  const apiKey = `pk_${randomBytes(16).toString('hex')}`
  const { data: key, error: keyError } = await client
    .from('api_keys')
    .insert({
      user_id: data.user.id,
      name: 'integration',
      key_hash: createHash('sha256').update(apiKey).digest('hex'),
      key_prefix: apiKey.slice(0, 8),
    })
    .select('id')
    .single()
  if (keyError || !key) throw keyError ?? new Error('key insert failed')

  return {
    id: data.user.id,
    email,
    password,
    client,
    apiKey,
    keyId: key.id,
    api: (path, init = {}) =>
      fetch(`${APP}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      }),
  }
}

/** Calls the app as a signed-in browser would, using the Supabase session cookie. */
export async function browserApi(user: TestUser, path: string, init: RequestInit = {}): Promise<Response> {
  const { data, error } = await publicClient().auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error || !data.session) throw error ?? new Error('sign-in failed')
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0]
  const value = Buffer.from(JSON.stringify(data.session)).toString('base64url')
  return fetch(`${APP}${path}`, {
    ...init,
    headers: {
      Cookie: `sb-${ref}-auth-token=base64-${value}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

/** Connects a fake Google account the way a browser does: connect, Google's redirect, the callback. */
export async function connectGoogle(user: TestUser, email: string): Promise<string | null> {
  await fakes('google/login-as', { email })
  const { data } = await publicClient().auth.signInWithPassword({ email: user.email, password: user.password })
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0]
  let cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`
  const start = await fetch(`${APP}/api/google/connect`, { headers: { Cookie: cookie }, redirect: 'manual' })
  cookie = `${cookie}; ${start.headers.getSetCookie().find((c) => c.startsWith('oauth_state='))!.split(';')[0]}`
  const atGoogle = await fetch(start.headers.get('location')!, { redirect: 'manual' })
  const back = await fetch(atGoogle.headers.get('location')!, { headers: { Cookie: cookie }, redirect: 'manual' })
  return back.headers.get('location')
}

export function cron(route: string): Promise<Response> {
  return fetch(`${APP}/api/cron/${route}`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })
}

export async function fakes<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${FAKES}/${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await res.json()) as T
}
