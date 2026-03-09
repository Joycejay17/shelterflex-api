import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestAgent } from '../test-helpers.js'
import { walletChallengeStore, userStore, sessionStore } from '../models/authStore.js'
import { _testOnly_clearAuthRateLimits } from '../middleware/authRateLimit.js'
import { ethers } from 'ethers'

describe('Wallet Auth Abuse Protection', () => {
  const request = createTestAgent()
  const wallet = ethers.Wallet.createRandom()
  const address = wallet.address

  beforeEach(() => {
    walletChallengeStore.clear()
    userStore.clear()
    sessionStore.clear()
    _testOnly_clearAuthRateLimits()
    vi.useRealTimers()
  })

  it('should fail when using a nonce that has already been verified (single-use)', async () => {
    // 1. Get challenge
    const challengeRes = await request
      .post('/api/auth/wallet/challenge')
      .send({ address })
      .expect(200)
    
    const { message } = challengeRes.body
    const signature = await wallet.signMessage(message)

    // 2. Verify successfully
    await request
      .post('/api/auth/wallet/verify')
      .send({ address, signature })
      .expect(200)

    // 3. Try to verify again with same signature/nonce
    const replayRes = await request
      .post('/api/auth/wallet/verify')
      .send({ address, signature })
    
    expect(replayRes.status).toBe(401)
    expect(replayRes.body.error.message).toBe('Invalid address or signature')
  })

  it('should fail and delete challenge when it has expired', async () => {
    vi.useFakeTimers()
    
    // 1. Get challenge
    const challengeRes = await request
      .post('/api/auth/wallet/challenge')
      .send({ address })
      .expect(200)
    
    const { message } = challengeRes.body
    const signature = await wallet.signMessage(message)

    // 2. Advance time by 6 minutes (TTL is 5 minutes)
    // WALLET_TTL_MS = 5 * 60 * 1000
    vi.advanceTimersByTime(6 * 60 * 1000)

    // 3. Try to verify
    const res = await request
      .post('/api/auth/wallet/verify')
      .send({ address, signature })
    
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
    
    // Challenge should be deleted
    expect(walletChallengeStore.getByAddress(address)).toBeUndefined()
  })

  it('should fail and delete challenge after too many failed attempts', async () => {
    // 1. Get challenge
    const challengeRes = await request
      .post('/api/auth/wallet/challenge')
      .send({ address })
      .expect(200)
    
    const { message } = challengeRes.body
    const invalidSignature = '0x' + '0'.repeat(130)

    // 2. Fail 3 times (MAX_ATTEMPTS is 3)
    for (let i = 0; i < 3; i++) {
      const res = await request
        .post('/api/auth/wallet/verify')
        .send({ address, signature: invalidSignature })
      
      expect(res.status).toBe(401)
      expect(res.body.error.message).toBe('Invalid address or signature')
    }

    // 3. Next attempt (even with valid signature) should fail because challenge is deleted
    const validSignature = await wallet.signMessage(message)
    const res = await request
      .post('/api/auth/wallet/verify')
      .send({ address, signature: validSignature })
    
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
    expect(walletChallengeStore.getByAddress(address)).toBeUndefined()
  })

  it('should rate limit challenge requests per address', async () => {
    // Limit is 20 per 15 mins (default options in walletAuthRateLimit)
    // Resetting for speed if possible? No, but let's just do it.
    for (let i = 0; i < 20; i++) {
      await request
        .post('/api/auth/wallet/challenge')
        .send({ address })
        .expect(200)
    }

    const res = await request
      .post('/api/auth/wallet/challenge')
      .send({ address })
    
    expect(res.status).toBe(429)
    expect(res.body.error.message).toContain('Too many requests for this wallet')
  })

  it('should return non-enumerating error for non-existent challenge', async () => {
    const res = await request
      .post('/api/auth/wallet/verify')
      .send({ address, signature: '0x' + '0'.repeat(130) })
    
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Invalid address or signature')
  })
})
