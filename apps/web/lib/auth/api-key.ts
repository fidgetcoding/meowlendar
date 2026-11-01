import { createServerClient } from '@supabase/ssr'
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { requireEnv } from '../env'

export interface ApiKeyAuth {
  userId: string
  keyId: string
}

/**
 * Verify a `Bearer pk_…` API key against the api_keys table (SHA-256 +
 * timingSafeEqual) and, on success, return the owning user and the key id.
 *
 * This lookup uses the service-role client because it runs *before* we know
 * which user is calling — the api_keys RLS policy is keyed on auth.uid(), which
 * isn't established yet. This is a narrow admin lookup only; the caller
 * (authenticate()) does NOT use a service-role client for the user's data.
 */
export async function authenticateApiKey(request: NextRequest): Promise<ApiKeyAuth | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer pk_')) {
    return null
  }

  const apiKey = authHeader.slice(7) // Remove "Bearer "

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      cookies: {
        getAll() { return [] },
        setAll() {},
      },
    }
  )

  const prefix = apiKey.slice(0, 8)
  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, user_id, key_hash')
    .eq('key_prefix', prefix)

  if (!keys || keys.length === 0) {
    console.warn('[auth] API key rejected: unknown prefix', { prefix })
    return null
  }

  for (const key of keys) {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(apiKey)
    const hashBuffer = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', keyData)))
    const expectedBuffer = Buffer.from(key.key_hash, 'hex')

    if (hashBuffer.length === expectedBuffer.length && timingSafeEqual(hashBuffer, expectedBuffer)) {
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', key.id)

      return { userId: key.user_id, keyId: key.id }
    }
  }

  console.warn('[auth] API key rejected: hash mismatch', { prefix })
  return null
}
