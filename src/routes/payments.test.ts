import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { outboxStore } from '../outbox/store.js'
import { OutboxStatus } from '../outbox/types.js'

describe('POST /api/payments/confirm', () => {
  const app = createApp()

  beforeEach(async () => {
    await outboxStore.clear()
  })

  it('should confirm payment and create outbox item', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({
        externalRef: 'stripe:pi_test123',
        dealId: 'deal-001',
        amount: '1000',
        payer: 'GABC123',
      })
      .expect('Content-Type', /json/)

    expect(response.status).toBeGreaterThanOrEqual(200)
    expect(response.status).toBeLessThan(300)
    expect(response.body.success).toBe(true)
    expect(response.body.outboxId).toBeDefined()
    expect(response.body.txId).toBeDefined()
    // Status can be pending, sent, or failed (due to simulated failures)
    expect(['pending', 'sent', 'failed']).toContain(response.body.status)
  })

  it('should be idempotent for duplicate external references', async () => {
    const payload = {
      externalRef: 'stripe:pi_duplicate',
      dealId: 'deal-001',
      amount: '1000',
      payer: 'GABC123',
    }

    const response1 = await request(app)
      .post('/api/payments/confirm')
      .send(payload)

    const response2 = await request(app)
      .post('/api/payments/confirm')
      .send(payload)

    expect(response1.body.outboxId).toBe(response2.body.outboxId)
    expect(response1.body.txId).toBe(response2.body.txId)
  })

  it('should reject invalid external reference format', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({
        externalRef: 'invalid-format',
        dealId: 'deal-001',
        amount: '1000',
        payer: 'GABC123',
      })
      .expect(400)

    expect(response.body.error).toBeDefined()
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should reject missing required fields', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({
        externalRef: 'stripe:pi_test',
        // missing dealId, amount, payer
      })
      .expect(400)

    expect(response.body.error).toBeDefined()
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('should reject invalid amount format', async () => {
    const response = await request(app)
      .post('/api/payments/confirm')
      .send({
        externalRef: 'stripe:pi_test',
        dealId: 'deal-001',
        amount: 'not-a-number',
        payer: 'GABC123',
      })
      .expect(400)

    expect(response.body.error).toBeDefined()
  })
})
