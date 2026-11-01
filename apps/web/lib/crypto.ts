import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { requireEnv } from './env'

// ---------------------------------------------------------------------------
// App-layer AES-256-GCM for at-rest secrets (Google OAuth tokens).
//
// Wire format:  v1:<iv_b64>:<ciphertext_b64>:<tag_b64>
//
// The key comes from GOOGLE_TOKEN_ENC_KEY, a base64-encoded 32-byte value.
// GCM gives us authenticated encryption: any tampering with the IV, ciphertext,
// or tag fails the auth check on decrypt.
// ---------------------------------------------------------------------------

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit nonce, the GCM standard
const KEY_BYTES = 32 // AES-256
const TAG_BYTES = 16

function getKey(): Buffer {
  const raw = requireEnv('GOOGLE_TOKEN_ENC_KEY')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[crypto] GOOGLE_TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes ` +
        `(got ${key.length}). Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }
  return key
}

/** True when the value is in this module's v1 wire format. */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`)
}

/** Encrypt a UTF-8 string into the v1 wire format. */
export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
  ].join(':')
}

/**
 * Decrypt a v1 payload back to plaintext. Throws if the payload is malformed or
 * fails the GCM authentication tag (tamper / wrong key).
 *
 * Values not in v1 format are refused. Every write goes through encryptToken, so
 * anything else in the column was not written by this app.
 */
export function decryptToken(payload: string): string {
  if (!isEncrypted(payload)) {
    throw new Error('[crypto] Refusing to use a token that is not encrypted')
  }

  const parts = payload.split(':')
  if (parts.length !== 4) {
    throw new Error('[crypto] Malformed encrypted token payload')
  }

  const ivB64 = parts[1]!
  const ctB64 = parts[2]!
  const tagB64 = parts[3]!

  const key = getKey()
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('[crypto] Malformed encrypted token payload')
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error(
      '[crypto] Token decryption failed — data may be tampered or the encryption key is wrong',
    )
  }
}
