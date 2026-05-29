import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  encryptPii,
  decryptPii,
  validatePiiEncryptionKey,
  encryptPersonalInfoFields,
  decryptPersonalInfoFields,
  isEncryptedPii,
} from './piiEncryption.js'

const ORIGINAL_ENV = process.env.ENCRYPTION_KEY

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(32)
})

afterEach(() => {
  process.env.ENCRYPTION_KEY = ORIGINAL_ENV
})

describe('piiEncryption', () => {
  it('encrypts and decrypts NIN/BVN roundtrip', () => {
    const nin = '12345678901'
    const encrypted = encryptPii(nin)
    expect(isEncryptedPii(encrypted)).toBe(true)
    expect(encrypted).not.toContain(nin)
    expect(decryptPii(encrypted)).toBe(nin)
  })

  it('encrypts personal info fields before storage', () => {
    const info = { fullName: 'Test User', nin: '12345678901', bvn: '22222222222' }
    const stored = encryptPersonalInfoFields(info)
    expect(typeof stored.nin).toBe('string')
    expect(stored.nin).not.toBe('12345678901')
    expect(isEncryptedPii(stored.nin as string)).toBe(true)

    const restored = decryptPersonalInfoFields(stored)
    expect(restored.nin).toBe('12345678901')
    expect(restored.bvn).toBe('22222222222')
  })

  it('validates hex key in production', () => {
    expect(() => validatePiiEncryptionKey('short', 'production')).toThrow()
    expect(() =>
      validatePiiEncryptionKey('0123456789abcdef'.repeat(4), 'production'),
    ).not.toThrow()
  })

  it('allows non-hex keys in development', () => {
    expect(() => validatePiiEncryptionKey('a'.repeat(32), 'development')).not.toThrow()
  })
})
