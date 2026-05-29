/**
 * AES-256-GCM encryption for PII fields (NIN, BVN, bank account numbers).
 *
 * Key management:
 * - Set ENCRYPTION_KEY to a 64-character hex string (32 bytes) in production.
 * - Key rotation: decrypt with old key, re-encrypt with new key during a maintenance window.
 *   Update ENCRYPTION_KEY and restart; run a one-off migration script to re-encrypt stored values.
 * - Never log plaintext PII or the raw encryption key.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const ENVELOPE_PREFIX = 'pii:v1:'

export interface PiiEncryptedEnvelope {
  iv: string
  ciphertext: string
  tag: string
}

function deriveKey(rawKey: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex')
  }
  return createHash('sha256').update(rawKey).digest()
}

/**
 * Validate ENCRYPTION_KEY at startup. Production requires 64-char hex; dev/test allow any >=32 chars.
 */
export function validatePiiEncryptionKey(
  key: string,
  nodeEnv: string = process.env.NODE_ENV ?? 'development',
): void {
  if (!key || key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters')
  }
  if (nodeEnv === 'production' && !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  const derived = deriveKey(key)
  if (derived.length !== KEY_LENGTH) {
    throw new Error(`Derived encryption key length invalid: expected ${KEY_LENGTH} bytes`)
  }
}

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? ''
  validatePiiEncryptionKey(raw, process.env.NODE_ENV)
  return deriveKey(raw)
}

/**
 * Encrypt a plaintext PII string. Returns a prefixed envelope string for DB storage.
 */
export function encryptPii(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope: PiiEncryptedEnvelope = {
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  }
  return ENVELOPE_PREFIX + Buffer.from(JSON.stringify(envelope)).toString('base64')
}

/**
 * Decrypt a PII envelope string. Returns plaintext.
 */
export function decryptPii(envelopeStr: string): string {
  if (!envelopeStr.startsWith(ENVELOPE_PREFIX)) {
    return envelopeStr
  }
  const key = getKey()
  const json = Buffer.from(envelopeStr.slice(ENVELOPE_PREFIX.length), 'base64').toString('utf8')
  const envelope = JSON.parse(json) as PiiEncryptedEnvelope

  const iv = Buffer.from(envelope.iv, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Invalid PII encryption envelope')
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

export function isEncryptedPii(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX)
}

/** Encrypt nin/bvn fields in a personalInfo object before DB storage. */
export function encryptPersonalInfoFields(
  info: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...info }
  for (const field of ['nin', 'bvn', 'bankAccountNumber'] as const) {
    const val = result[field]
    if (typeof val === 'string' && val.length > 0 && !isEncryptedPii(val)) {
      result[field] = encryptPii(val)
    }
  }
  return result
}

/** Decrypt nin/bvn fields when reading personalInfo from DB (internal use only). */
export function decryptPersonalInfoFields(
  info: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...info }
  for (const field of ['nin', 'bvn', 'bankAccountNumber'] as const) {
    const val = result[field]
    if (typeof val === 'string' && isEncryptedPii(val)) {
      result[field] = decryptPii(val)
    }
  }
  return result
}
