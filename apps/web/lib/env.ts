import { z } from 'zod'

// ---------------------------------------------------------------------------
// Environment access, fail-loud.
//
// A literal value of "placeholder" (case-insensitive, after trimming) is
// treated as MISSING. That exact failure mode — scaffold env values shipped
// verbatim to production — took Poolendar down in June 2026. We never want a
// "placeholder" secret to silently resolve to a truthy string again.
// ---------------------------------------------------------------------------

const PLACEHOLDER = 'placeholder'

/** Returns undefined for missing, empty, or placeholder values. */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (trimmed.toLowerCase() === PLACEHOLDER) return undefined
  return value
}

/** Required in production. Missing/placeholder → hard failure. */
export const REQUIRED_SERVER_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_TOKEN_ENC_KEY',
] as const

/** Optional — absence disables a feature and logs one warning. */
export const OPTIONAL_SERVER_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'CRON_SECRET',
] as const

export type RequiredEnvKey = (typeof REQUIRED_SERVER_ENV)[number]
export type OptionalEnvKey = (typeof OPTIONAL_SERVER_ENV)[number]

/**
 * Read a required environment variable. Throws a clear, actionable error when
 * the value is missing or set to the literal "placeholder".
 */
export function requireEnv(name: RequiredEnvKey | (string & {})): string {
  const value = clean(process.env[name])
  if (value === undefined) {
    throw new Error(
      `[env] Required environment variable "${name}" is missing or set to a placeholder. ` +
        `Set a real value — "placeholder" is treated as unset ` +
        `(this exact failure mode took the app down in June 2026).`,
    )
  }
  return value
}

const warned = new Set<string>()

/**
 * Read an optional environment variable. Returns undefined and logs a single
 * warning per key when unset/placeholder; the caller decides how to degrade.
 */
export function optionalEnv(name: OptionalEnvKey | (string & {})): string | undefined {
  const value = clean(process.env[name])
  if (value === undefined && !warned.has(name)) {
    warned.add(name)
    console.warn(
      `[env] Optional environment variable "${name}" is not set — related features are disabled.`,
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// Boot-time / test validation of the full required set.
// ---------------------------------------------------------------------------

const nonPlaceholder = z
  .string()
  .min(1, { message: 'must be set' })
  .refine((v) => v.trim().toLowerCase() !== PLACEHOLDER, {
    message: 'must not be the literal "placeholder"',
  })

export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: nonPlaceholder,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonPlaceholder,
  SUPABASE_SERVICE_ROLE_KEY: nonPlaceholder,
  GOOGLE_TOKEN_ENC_KEY: nonPlaceholder,
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/**
 * Validate all required server env vars at once. Throws with every offending
 * key listed. Intended for a boot-time check (wired fully in Phase 3) and for
 * tests.
 */
export function validateServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(env)
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`[env] Server environment validation failed:\n${problems}`)
  }
  return result.data
}
