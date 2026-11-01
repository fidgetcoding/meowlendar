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
