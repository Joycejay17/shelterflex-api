/**
 * Unit tests for the env schema — specifically the Soroban token ID validation.
 *
 * These tests are isolated and do not depend on a running server or database.
 * We inline the envSchema logic here to avoid the module-level parse() singleton
 * in env.ts which requires process.env to be fully populated.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ─── Replicate the minimal schema under test ─────────────────────────────────
// We duplicate only the relevant parts to avoid importing the module-level parse.
const sorobanNetworkEnum = z.enum(['local', 'testnet', 'mainnet'])

const testEnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().default('development'),
  SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  SOROBAN_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
  SOROBAN_CONTRACT_ID: z.string().optional(),
  SOROBAN_NETWORK: sorobanNetworkEnum.default('testnet'),
  USDC_TOKEN_ADDRESS: z.string().optional(),
  SOROBAN_USDC_TOKEN_ID: z.string().optional(),
  ENCRYPTION_KEY: z.string().min(32, 'Encryption key must be at least 32 characters'),
  CUSTODIAL_WALLET_MASTER_KEY_V1: z.string().optional(),
  CUSTODIAL_WALLET_MASTER_KEY_V2: z.string().optional(),
  CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION: z.coerce.number().default(1),
  CUSTODIAL_MODE_ENABLED: z.coerce.boolean().default(true),
  WEBHOOK_SIGNATURE_ENABLED: z.coerce.boolean().default(false),
  WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_SECRET: z.string().optional(),
  FLUTTERWAVE_SECRET: z.string().optional(),
  MANUAL_ADMIN_SECRET: z.string().optional(),
}).refine((data) => {
  const tokenId = data.SOROBAN_USDC_TOKEN_ID || data.USDC_TOKEN_ADDRESS
  if (data.NODE_ENV !== 'development' && data.NODE_ENV !== 'test' && !tokenId) return false
  const SOROBAN_CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/
  if (tokenId && !SOROBAN_CONTRACT_ID_REGEX.test(tokenId)) return false
  return true
}, {
  message: 'SOROBAN_USDC_TOKEN_ID (or USDC_TOKEN_ADDRESS) is required outside development/test and must be a valid Soroban contract ID (a 56-character Stellar StrKey starting with "C")',
  path: ['SOROBAN_USDC_TOKEN_ID'],
})
  .refine((data) => {
    if (data.NODE_ENV === 'development' || data.NODE_ENV === 'test') return true
    if (!data.CUSTODIAL_WALLET_MASTER_KEY_V1) return false
    const active = data.CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION
    if (active === 2 && !data.CUSTODIAL_WALLET_MASTER_KEY_V2) return false
    if (active !== 1 && active !== 2) return false
    return true
  }, { message: 'Custodial wallet master keys must be configured for active encryption version', path: ['CUSTODIAL_WALLET_MASTER_KEY_ACTIVE_VERSION'] })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.WEBHOOK_SECRET
  }, { message: 'WEBHOOK_SECRET is required in production', path: ['WEBHOOK_SECRET'] })
  .refine((data) => {
    if (!data.WEBHOOK_SIGNATURE_ENABLED) return true
    return !!data.WEBHOOK_SECRET
  }, { message: 'WEBHOOK_SECRET is required when WEBHOOK_SIGNATURE_ENABLED is true', path: ['WEBHOOK_SECRET'] })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.PAYSTACK_SECRET
  }, { message: 'PAYSTACK_SECRET is required in production', path: ['PAYSTACK_SECRET'] })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.FLUTTERWAVE_SECRET
  }, { message: 'FLUTTERWAVE_SECRET is required in production', path: ['FLUTTERWAVE_SECRET'] })
  .refine((data) => {
    if (data.NODE_ENV !== 'production') return true
    return !!data.MANUAL_ADMIN_SECRET
  }, { message: 'MANUAL_ADMIN_SECRET is required in production', path: ['MANUAL_ADMIN_SECRET'] })

// ─── helpers ────────────────────────────────────────────────────────────────

/** Minimal set of env vars that satisfy all *other* refine rules */
const BASE_ENV = {
  ENCRYPTION_KEY: 'a'.repeat(32),
  NODE_ENV: 'development', // skips token/custodial/webhook/paystack/flutterwave/admin checks
}

function parse(extra: Record<string, unknown>) {
  return testEnvSchema.safeParse({ ...BASE_ENV, ...extra })
}

// ─── SOROBAN_USDC_TOKEN_ID validation ───────────────────────────────────────

describe('envSchema — Soroban token ID validation', () => {
  // A valid Soroban contract ID: starts with 'C', 56 characters of base32 uppercase
  const VALID_CONTRACT_ID = 'CAQGAQLQFJZ7PLOMCQN2I2NXHLQXF5DDD7T3IZQDTCZP3VYP7DVHLVSA'

  describe('accepts valid Soroban contract IDs', () => {
    it('accepts a valid SOROBAN_USDC_TOKEN_ID', () => {
      const result = parse({ SOROBAN_USDC_TOKEN_ID: VALID_CONTRACT_ID })
      expect(result.success).toBe(true)
    })

    it('accepts a valid USDC_TOKEN_ADDRESS (alias)', () => {
      const result = parse({ USDC_TOKEN_ADDRESS: VALID_CONTRACT_ID })
      expect(result.success).toBe(true)
    })

    it('accepts when neither is provided in development', () => {
      // In development NODE_ENV the fields are optional
      const result = parse({})
      expect(result.success).toBe(true)
    })

    it('prefers SOROBAN_USDC_TOKEN_ID over USDC_TOKEN_ADDRESS when both are set', () => {
      const result = parse({
        SOROBAN_USDC_TOKEN_ID: VALID_CONTRACT_ID,
        USDC_TOKEN_ADDRESS: 'INVALID', // would fail if used
      })
      // SOROBAN_USDC_TOKEN_ID is checked first and is valid, so parse succeeds
      expect(result.success).toBe(true)
    })
  })

  describe('rejects invalid token IDs', () => {
    it('rejects an Ethereum 0x address', () => {
      const result = parse({ SOROBAN_USDC_TOKEN_ID: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' })
      expect(result.success).toBe(false)
    })

    it('rejects a string that is too short', () => {
      const result = parse({ SOROBAN_USDC_TOKEN_ID: 'CABC' })
      expect(result.success).toBe(false)
    })

    it('rejects a string that does not start with C', () => {
      // Same length as a valid contract ID but wrong prefix
      const result = parse({ SOROBAN_USDC_TOKEN_ID: 'GAQGAQLQFJZ7PLOMCQN2I2NXHLQXF5DDD7T3IZQDTCZP3VYP7DVHLVS' })
      expect(result.success).toBe(false)
    })

    it('rejects a string with invalid base32 characters (lowercase)', () => {
      const result = parse({ USDC_TOKEN_ADDRESS: 'caqgaqlqfjz7plomcqn2i2nxhlqxf5ddd7t3izqdtczp3vyp7dvhlvs' })
      expect(result.success).toBe(false)
    })

    it('error message mentions Soroban/Stellar, not Ethereum', () => {
      const result = parse({ SOROBAN_USDC_TOKEN_ID: '0xdeadbeef' })
      expect(result.success).toBe(false)
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? ''
        expect(msg).toMatch(/Soroban|Stellar/i)
        expect(msg).not.toMatch(/Ethereum/i)
      }
    })
  })

  describe('requires a token in non-development environments', () => {
    const PROD_ENV = {
      ENCRYPTION_KEY: 'a'.repeat(32),
      NODE_ENV: 'production',
      CUSTODIAL_WALLET_MASTER_KEY_V1: 'a'.repeat(32),
      WEBHOOK_SECRET: 'secret',
      PAYSTACK_SECRET: 'paystack',
      FLUTTERWAVE_SECRET: 'flutter',
      MANUAL_ADMIN_SECRET: 'admin',
    }

    it('fails in production when no token is provided', () => {
      const result = testEnvSchema.safeParse(PROD_ENV)
      expect(result.success).toBe(false)
    })

    it('passes in production when SOROBAN_USDC_TOKEN_ID is set', () => {
      const result = testEnvSchema.safeParse({ ...PROD_ENV, SOROBAN_USDC_TOKEN_ID: VALID_CONTRACT_ID })
      expect(result.success).toBe(true)
    })

    it('passes in production when USDC_TOKEN_ADDRESS alias is set', () => {
      const result = testEnvSchema.safeParse({ ...PROD_ENV, USDC_TOKEN_ADDRESS: VALID_CONTRACT_ID })
      expect(result.success).toBe(true)
    })
  })
})
