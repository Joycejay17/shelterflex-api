import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { depositStore } from '../models/depositStore.js'
import { outboxStore } from '../outbox/store.js'

describe('Payments webhook', () => {
  const app = createApp()

  beforeEach(async () => {
    await depositStore.clear()
    await outboxStore.clear()
    delete process.env.WEBHOOK_SIGNATURE_ENABLED
    delete process.env.WEBHOOK_SECRET
  })

  afterEach(async () => {
    await depositStore.clear()
    await outboxStore.clear()
  })

  it('is idempotent on replay (rail, externalRef)', async () => {
    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', 'user-001')
      .set('x-amount-ngn', '160000')
      .send({ quoteId: 'q-001', paymentRail: 'psp' })
      .expect(201)

    const { depositId, externalRef } = init.body

    const payload = {
      externalRefSource: 'psp',
      externalRef,
      status: 'confirmed',
    }

    await request(app).post('/api/webhooks/payments/psp').send(payload).expect(200)
    await request(app).post('/api/webhooks/payments/psp').send(payload).expect(200)

    const items = await outboxStore.listAll(10)
    expect(items.length).toBe(1)
    expect(items[0].payload.txType).toBe('stake')
  })

  it('rejects invalid signature when enabled', async () => {
    process.env.WEBHOOK_SIGNATURE_ENABLED = 'true'
    process.env.WEBHOOK_SECRET = 'secret123'

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', 'user-002')
      .set('x-amount-ngn', '320000')
      .send({ quoteId: 'q-002', paymentRail: 'psp' })
      .expect(201)

    const { externalRef } = init.body
    const payload = {
      externalRefSource: 'psp',
      externalRef,
      status: 'confirmed',
    }

    await request(app)
      .post('/api/webhooks/payments/psp')
      .set('x-webhook-signature', 'wrong')
      .send(payload)
      .expect(401)
  })
})
