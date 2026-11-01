import { describe, it, expect, beforeEach } from 'vitest'
import { encryptToken, decryptToken, isEncrypted } from '../crypto'

const KEY = Buffer.alloc(32, 9).toString('base64')

describe('crypto (AES-256-GCM token encryption)', () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENC_KEY = KEY
  })

  it('round-trips a token through encrypt → decrypt', () => {
    const plaintext = 'ya29.super-secret-google-access-token'
    const enc = encryptToken(plaintext)

    expect(enc).not.toContain(plaintext)
    expect(isEncrypted(enc)).toBe(true)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc.split(':')).toHaveLength(4)
    expect(decryptToken(enc)).toBe(plaintext)
  })

  it('produces distinct ciphertext each call (random IV) but decrypts equally', () => {
    const a = encryptToken('same-input')
    const b = encryptToken('same-input')
    expect(a).not.toBe(b)
    expect(decryptToken(a)).toBe('same-input')
    expect(decryptToken(b)).toBe('same-input')
  })

  it('rejects a tampered ciphertext (GCM auth tag fails)', () => {
    const enc = encryptToken('tamper-me')
    const parts = enc.split(':')
    const ct = Buffer.from(parts[2]!, 'base64')
    ct[0] = ct[0]! ^ 0xff
    const tampered = [parts[0], parts[1], ct.toString('base64'), parts[3]].join(':')
    expect(() => decryptToken(tampered)).toThrow(/decryption failed|tampered/i)
  })

  it('rejects a tampered auth tag', () => {
    const enc = encryptToken('tag-check')
    const parts = enc.split(':')
    const tag = Buffer.from(parts[3]!, 'base64')
    tag[0] = tag[0]! ^ 0xff
    const tampered = [parts[0], parts[1], parts[2], tag.toString('base64')].join(':')
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('refuses values that are not in v1 format', () => {
    expect(isEncrypted('legacy-plaintext-token')).toBe(false)
    expect(() => decryptToken('legacy-plaintext-token')).toThrow(/not encrypted/)
  })

  it('throws a clear error when the key is missing', () => {
    delete process.env.GOOGLE_TOKEN_ENC_KEY
    expect(() => encryptToken('x')).toThrow(/GOOGLE_TOKEN_ENC_KEY/)
  })

  it('treats a "placeholder" key as missing', () => {
    process.env.GOOGLE_TOKEN_ENC_KEY = 'placeholder'
    expect(() => encryptToken('x')).toThrow(/GOOGLE_TOKEN_ENC_KEY/)
  })

  it('throws when the key does not decode to 32 bytes', () => {
    process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.alloc(16).toString('base64')
    expect(() => encryptToken('x')).toThrow(/32 bytes/)
  })
})
