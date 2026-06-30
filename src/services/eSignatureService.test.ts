import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StubESignatureProvider } from './eSignatureService.js'
import type { Signer } from './eSignatureService.js'

const DOC_KEY = 'lease/deal-abc/123e4567-e89b-12d3-a456-426614174000.pdf'
const DOC_HASH = 'a'.repeat(64)
const SIGNERS: Signer[] = [
  { id: 'tenant-1', name: 'Alice', email: 'alice@test.com', role: 'tenant' },
  { id: 'landlord-1', name: 'Bob', email: 'bob@test.com', role: 'landlord' },
]

function tokenFromUrl(url: string): string {
  return new URLSearchParams(url.split('?')[1]).get('token')!
}

describe('StubESignatureProvider', () => {
  let provider: StubESignatureProvider

  beforeEach(() => {
    provider = new StubESignatureProvider()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createSigningRequest — document-hash binding', () => {
    it('returns a signing request with the exact documentHash passed in', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      expect(req.documentHash).toBe(DOC_HASH)
    })

    it('includes documentKey, signers, status and a uuid requestId', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      expect(req.requestId).toMatch(/^[\da-f-]{36}$/)
      expect(req.documentKey).toBe(DOC_KEY)
      expect(req.signers).toEqual(SIGNERS)
      expect(req.status).toBe('pending')
      expect(req.createdAt).toBeInstanceOf(Date)
    })

    it('different documentHash values produce distinct requests', async () => {
      const req1 = await provider.createSigningRequest(DOC_KEY, 'hash-aaa', SIGNERS)
      const req2 = await provider.createSigningRequest(DOC_KEY, 'hash-bbb', SIGNERS)
      expect(req1.documentHash).toBe('hash-aaa')
      expect(req2.documentHash).toBe('hash-bbb')
      expect(req1.requestId).not.toBe(req2.requestId)
    })
  })

  describe('getSigningUrl', () => {
    it('returns a URL containing the token, signerId and requestId', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url, expiresAt } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      expect(url).toContain('token=')
      expect(url).toContain(`signer=${SIGNERS[0].id}`)
      expect(url).toContain(`requestId=${req.requestId}`)
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('generates a unique token per signer', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url: url1 } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const { url: url2 } = await provider.getSigningUrl(req.requestId, SIGNERS[1].id)
      expect(tokenFromUrl(url1)).not.toBe(tokenFromUrl(url2))
    })

    it('throws for an unknown requestId', async () => {
      await expect(provider.getSigningUrl('nonexistent-id', SIGNERS[0].id)).rejects.toThrow()
    })

    it('throws for an unknown signerId', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      await expect(provider.getSigningUrl(req.requestId, 'unknown-signer')).rejects.toThrow()
    })
  })

  describe('handleWebhook — callback authenticity', () => {
    it('accepts a valid token and returns signed: true', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const token = tokenFromUrl(url)
      const result = await provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId })
      expect(result).toEqual({ requestId: req.requestId, signerId: SIGNERS[0].id, signed: true })
    })

    it('rejects an invalid token', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      await expect(
        provider.handleWebhook({ token: 'wrong-token', signer: SIGNERS[0].id, requestId: req.requestId }),
      ).rejects.toThrow()
    })

    it('rejects an unknown requestId', async () => {
      await expect(
        provider.handleWebhook({ token: 'any', signer: SIGNERS[0].id, requestId: 'nonexistent' }),
      ).rejects.toThrow()
    })

    it('rejects an unknown signerId', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      await expect(
        provider.handleWebhook({ token: 'any', signer: 'unknown-signer', requestId: req.requestId }),
      ).rejects.toThrow()
    })

    it('one signer token does not authenticate another signer', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const tenantToken = tokenFromUrl(url)
      await expect(
        provider.handleWebhook({ token: tenantToken, signer: SIGNERS[1].id, requestId: req.requestId }),
      ).rejects.toThrow()
    })
  })

  describe('handleWebhook — replay protection', () => {
    it('rejects a second call with the same token', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const token = tokenFromUrl(url)

      await provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId })

      await expect(
        provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId }),
      ).rejects.toThrow()
    })

    it('allows each signer to use their own token exactly once', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url: url1 } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const { url: url2 } = await provider.getSigningUrl(req.requestId, SIGNERS[1].id)
      const token1 = tokenFromUrl(url1)
      const token2 = tokenFromUrl(url2)

      await provider.handleWebhook({ token: token1, signer: SIGNERS[0].id, requestId: req.requestId })
      await provider.handleWebhook({ token: token2, signer: SIGNERS[1].id, requestId: req.requestId })

      await expect(
        provider.handleWebhook({ token: token1, signer: SIGNERS[0].id, requestId: req.requestId }),
      ).rejects.toThrow()
      await expect(
        provider.handleWebhook({ token: token2, signer: SIGNERS[1].id, requestId: req.requestId }),
      ).rejects.toThrow()
    })
  })

  describe('handleWebhook — expiry checking', () => {
    it('rejects a token presented after the 15-minute window', async () => {
      const FIXED_NOW = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)

      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const token = tokenFromUrl(url)

      vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW + 16 * 60 * 1000)

      await expect(
        provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId }),
      ).rejects.toThrow(/expired/i)
    })

    it('accepts a token presented within the 15-minute window', async () => {
      const FIXED_NOW = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)

      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const token = tokenFromUrl(url)

      vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW + 14 * 60 * 1000)

      const result = await provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId })
      expect(result.signed).toBe(true)
    })
  })

  describe('verifySignature', () => {
    it('returns false before the signer calls handleWebhook', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      expect(await provider.verifySignature(req.requestId, SIGNERS[0].id)).toBe(false)
    })

    it('returns true after a successful handleWebhook call', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const token = tokenFromUrl(url)
      await provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId })
      expect(await provider.verifySignature(req.requestId, SIGNERS[0].id)).toBe(true)
    })

    it('returns false for a signer who has not yet signed even after another signer completes', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      const { url } = await provider.getSigningUrl(req.requestId, SIGNERS[0].id)
      const token = tokenFromUrl(url)
      await provider.handleWebhook({ token, signer: SIGNERS[0].id, requestId: req.requestId })

      expect(await provider.verifySignature(req.requestId, SIGNERS[1].id)).toBe(false)
    })

    it('returns false for an unknown requestId', async () => {
      expect(await provider.verifySignature('nonexistent', SIGNERS[0].id)).toBe(false)
    })

    it('returns false for an unknown signerId on a valid request', async () => {
      const req = await provider.createSigningRequest(DOC_KEY, DOC_HASH, SIGNERS)
      expect(await provider.verifySignature(req.requestId, 'unknown-signer')).toBe(false)
    })
  })
})
