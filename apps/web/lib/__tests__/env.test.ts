import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { requireEnv, optionalEnv, validateServerEnv } from '../env'

const SAVED = process.env

describe('env', () => {
  beforeEach(() => {
    process.env = { ...SAVED }
  })
  afterEach(() => {
    process.env = SAVED
  })

  describe('requireEnv', () => {
    it('returns a set value', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'real-secret'
      expect(requireEnv('SUPABASE_SERVICE_ROLE_KEY')).toBe('real-secret')
    })

    it('throws when the value is missing', () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      expect(() => requireEnv('SUPABASE_SERVICE_ROLE_KEY')).toThrow(/missing or set to a placeholder/)
    })

    it('treats "placeholder" as missing (case-insensitive)', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'Placeholder'
      expect(() => requireEnv('SUPABASE_SERVICE_ROLE_KEY')).toThrow(/placeholder/i)
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'PLACEHOLDER'
      expect(() => requireEnv('SUPABASE_SERVICE_ROLE_KEY')).toThrow()
    })

    it('treats empty / whitespace-only as missing', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = '   '
      expect(() => requireEnv('SUPABASE_SERVICE_ROLE_KEY')).toThrow()
    })
  })

  describe('optionalEnv', () => {
    it('returns undefined when unset', () => {
      delete process.env.RESEND_API_KEY
      expect(optionalEnv('RESEND_API_KEY')).toBeUndefined()
    })

    it('returns the value when set', () => {
      process.env.RESEND_API_KEY = 're_123'
      expect(optionalEnv('RESEND_API_KEY')).toBe('re_123')
    })
  })

  describe('validateServerEnv', () => {
    const full = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
      GOOGLE_TOKEN_ENC_KEY: 'enc',
    }

    it('accepts a fully-populated env', () => {
      expect(() => validateServerEnv(full as NodeJS.ProcessEnv)).not.toThrow()
    })

    it('rejects a placeholder value and names the offending key', () => {
      expect(() =>
        validateServerEnv({ ...full, SUPABASE_SERVICE_ROLE_KEY: 'placeholder' } as NodeJS.ProcessEnv),
      ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
    })

    it('rejects a missing required key', () => {
      const partial: Record<string, string> = { ...full }
      delete partial.GOOGLE_TOKEN_ENC_KEY
      expect(() => validateServerEnv(partial as NodeJS.ProcessEnv)).toThrow(/GOOGLE_TOKEN_ENC_KEY/)
    })
  })
})
