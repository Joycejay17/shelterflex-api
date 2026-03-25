import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { quoteStore } from '../models/quoteStore.js'
import { depositStore } from '../models/depositStore.js'
import { sessionStore, userStore } from '../models/authStore.js'

describe('Staking Quote API', () => {
  let app: any
  let authToken: string
  let userId: string

  beforeEach(async () => {
    process.env.QUOTE_EXPIRY_MS = '50'
    app = createApp()
    await quoteStore.clear()
    await depositStore.clear()
    const email = 'quote-test@example.com'
    const user = await userStore.getOrCreateByEmail(email)
    userId = user.id
    authToken = 'test-token-quote'
    await sessionStore.create(email, authToken)
  })

  it('returns a quote and rejects reuse', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)
    expect(q.body.quoteId).toBeDefined()
    expect(q.body.estimatedAmountUsdc).toMatch(/^\d+\.\d{6}$/)
    const quoteId = q.body.quoteId
    const init1 = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '160000')
      .send({ quoteId, paymentRail: 'manual_admin' })
      .expect(201)
    expect(init1.body.success).toBe(true)
    await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '160000')
      .send({ quoteId, paymentRail: 'manual_admin' })
      .expect(409)
  })

  it('rejects expired quote', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)
    const quoteId = q.body.quoteId
    await quoteStore.markExpired(quoteId)
    await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', userId)
      .set('x-amount-ngn', '160000')
      .send({ quoteId, paymentRail: 'manual_admin' })
      .expect(409)
  })

  it('rejects missing x-user-id header for deposit initiation', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)

    const response = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-amount-ngn', '160000')
      .send({ quoteId: q.body.quoteId, paymentRail: 'manual_admin' })
      .expect(400)

    expect(response.body.error?.message).toBe('Missing x-user-id header')
  })

  it('rejects invalid x-user-id header for deposit initiation', async () => {
    const q = await request(app)
      .post('/api/staking/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amountNgn: 160000, paymentRail: 'manual_admin' })
      .expect(201)

    const response = await request(app)
      .post('/api/staking/deposit/initiate')
      .set('x-user-id', 'bad user id!')
      .set('x-amount-ngn', '160000')
      .send({ quoteId: q.body.quoteId, paymentRail: 'manual_admin' })
      .expect(400)

    expect(response.body.error?.message).toBe(
      'Invalid x-user-id header: expected 3-128 chars of letters, numbers, underscore, or hyphen'
    )
  })
})
