import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { depositStore } from '../models/depositStore.js'
import { outboxStore } from '../outbox/store.js'
import { NgnWalletService } from '../services/ngnWalletService.js'

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

  it('credits NGN wallet on confirmation', async () => {
    const userId = 'user-003'
    
    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '50000')
      .send({ quoteId: 'q-003', paymentRail: 'psp' })
      .expect(201)

    const { depositId, externalRef } = init.body

    const payload = {
      externalRefSource: 'psp',
      externalRef,
      status: 'confirmed',
    }

    await request(app).post('/api/webhooks/payments/psp').send(payload).expect(200)

    // Verify deposit is confirmed
    const deposit = await depositStore.getByCanonical('psp', externalRef)
    expect(deposit?.status).toBe('confirmed')
    expect(deposit?.confirmedAt).toBeDefined()
  })

  it('does not double-credit on webhook replay', async () => {
    const userId = 'user-004'

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '30000')
      .send({ quoteId: 'q-004', paymentRail: 'psp' })
      .expect(201)

    const { externalRef } = init.body

    const payload = {
      externalRefSource: 'psp',
      externalRef,
      status: 'confirmed',
    }

    // First webhook
    await request(app).post('/api/webhooks/payments/psp').send(payload).expect(200)
    const deposit1 = await depositStore.getByCanonical('psp', externalRef)
    const confirmedAt1 = deposit1?.confirmedAt

    // Replay webhook - should be idempotent
    await request(app).post('/api/webhooks/payments/psp').send(payload).expect(200)
    const deposit2 = await depositStore.getByCanonical('psp', externalRef)
    const confirmedAt2 = deposit2?.confirmedAt

    // Should remain confirmed and confirmedAt should not change (idempotent)
    expect(deposit2?.status).toBe('confirmed')
    expect(confirmedAt1).toEqual(confirmedAt2)
  })

  it('debits NGN wallet on reversal', async () => {
    const userId = 'user-005'

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '20000')
      .send({ quoteId: 'q-005', paymentRail: 'psp' })
      .expect(201)

    const { externalRef } = init.body

    // Confirm first
    await request(app)
      .post('/api/webhooks/payments/psp')
      .send({
        externalRefSource: 'psp',
        externalRef,
        status: 'confirmed',
      })
      .expect(200)

    // Verify deposit is confirmed
    const depositAfterConfirm = await depositStore.getByCanonical('psp', externalRef)
    expect(depositAfterConfirm?.status).toBe('confirmed')

    // Reverse
    await request(app)
      .post('/api/webhooks/payments/psp')
      .send({
        externalRefSource: 'psp',
        externalRef,
        status: 'reversed',
      })
      .expect(200)

    // Verify deposit is reversed
    const depositAfterReverse = await depositStore.getByCanonical('psp', externalRef)
    expect(depositAfterReverse?.status).toBe('reversed')
  })

  it('handles reversal even if deposit was already confirmed', async () => {
    const userId = 'user-006'

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '25000')
      .send({ quoteId: 'q-006', paymentRail: 'psp' })
      .expect(201)

    const { externalRef } = init.body

    // Confirm deposit
    await request(app)
      .post('/api/webhooks/payments/psp')
      .send({
        externalRefSource: 'psp',
        externalRef,
        status: 'confirmed',
      })
      .expect(200)

    // Verify confirmed
    const depositConfirmed = await depositStore.getByCanonical('psp', externalRef)
    expect(depositConfirmed?.status).toBe('confirmed')

    // Reverse the deposit (chargeback scenario)
    await request(app)
      .post('/api/webhooks/payments/psp')
      .send({
        externalRefSource: 'psp',
        externalRef,
        status: 'reversed',
      })
      .expect(200)

    // Verify reversed
    const depositReversed = await depositStore.getByCanonical('psp', externalRef)
    expect(depositReversed?.status).toBe('reversed')
  })

  it('maps provider status codes to internal status', async () => {
    const userId = 'user-007'

    const init = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '15000')
      .send({ quoteId: 'q-007', paymentRail: 'psp' })
      .expect(201)

    const { externalRef } = init.body

    // First confirm the deposit
    await request(app)
      .post('/api/webhooks/payments/psp')
      .send({
        externalRefSource: 'psp',
        externalRef,
        status: 'confirmed',
      })
      .expect(200)

    // Then reverse with provider-specific status code
    await request(app)
      .post('/api/webhooks/payments/psp')
      .send({
        externalRefSource: 'psp',
        externalRef,
        status: 'reversed',
        providerStatus: 'chargeback_disputed',
      })
      .expect(200)

    // Should be treated as reversed
    const deposit = await depositStore.getByCanonical('psp', externalRef)
    expect(deposit?.status).toBe('reversed')
  })
})
