import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { outboxStore } from '../outbox/store.js'

describe('POST /api/payments/confirm', () => {
  const app = createApp()

  beforeEach(async () => {
    await outboxStore.clear()
  })

  const basePayload = {
    dealId: 'deal-001',
    txType: 'tenant_repayment',
    amountUsdc: '100.50',
    tokenAddress: 'USDC_TOKEN_ADDRESS_TESTNET',
    externalRefSource: 'stripe',
    externalRef: 'pi_test123',
  }

  it('should confirm payment and create outbox item', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send(basePayload)
      .expect('Content-Type', /json/)

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(300)
    expect(response.body.success).toBe(true)
    expect(response.body.outboxId).toBeDefined()
    expect(response.body.txId).toBeDefined()
    expect(response.body.txId).toHaveLength(64) // SHA-256 hex
    expect(['pending', 'sent', 'failed']).toContain(response.body.status)
  })

  it('should include optional NGN metadata', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({
        ...basePayload,
        amountNgn: 155000,
        fxRateNgnPerUsdc: 1550,
        fxProvider: 'exchangerate-api',
      })
      .expect('Content-Type', /json/)

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(300)
    expect(response.body.success).toBe(true)
  })

  it('should be idempotent — confirming the same (externalRefSource, externalRef) twice returns the same receipt', async () => {
    const payload = {
      ...basePayload,
      externalRefSource: 'stripe',
      externalRef: 'pi_duplicate_idempotency_test',
    }

    const response1 = await request(app)
      .post('/api/payments/confirm')
      .send(payload)

    const response2 = await request(app)
      .post('/api/payments/confirm')
      .send(payload)

    // Same canonical ref → same outboxId and txId — no duplicate created
    expect(response1.body.outboxId).toBe(response2.body.outboxId)
    expect(response1.body.txId).toBe(response2.body.txId)
  })

  it('should reject missing required fields', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({ dealId: 'deal-001' })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should reject invalid txType', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({ ...basePayload, txType: 'invalid_type' })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should reject invalid amountUsdc format', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({ ...basePayload, amountUsdc: 'not-a-number' })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should reject amountUsdc with too many decimal places', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({ ...basePayload, amountUsdc: '1.1234567' }) // 7 decimal places — USDC has 6
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should accept all three txType values', async () => {
    const types = ['tenant_repayment', 'landlord_payout', 'whistleblower_reward']
    for (const txType of types) {
      await outboxStore.clear()
      const response = await request(app)
        .post('/api/payments/confirm')
        .send({ ...basePayload, txType })

      expect(response.status).toBeGreaterThanOrEqual(200)
      expect(response.status).toBeLessThan(300)
    }
  })
})
