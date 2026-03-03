import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp } from '../app.js'
import { outboxStore } from '../outbox/index.js'
import request from 'supertest'
import { TxType, OutboxStatus } from '../outbox/types.js'

describe('Staking API', () => {
  let app: any

  beforeEach(async () => {
    app = createApp()
    await outboxStore.clear()
    vi.clearAllMocks()
  })

  describe('POST /api/staking/stake', () => {
    it('should stake tokens successfully', async () => {
      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          amountUsdc: '1000.000000',
          externalRefSource: 'manual',
          externalRef: 'stake-2024-01-15-001',
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.outboxId).toBeDefined()
      expect(response.body.txId).toMatch(/^[a-f0-9]{64}$/)
      expect(response.body.status).toBe(OutboxStatus.SENT)
      expect(response.body.message).toBe('Staking confirmed and receipt written to chain')
    })

    it('should return 202 when staking is queued for retry', async () => {
      // Mock the sender to fail once
      const mockSender = await import('../outbox/sender.js')
      const originalSend = mockSender.OutboxSender.prototype.send
      const sendSpy = vi
        .spyOn(mockSender.OutboxSender.prototype, 'send')
        .mockResolvedValueOnce(false) // First call fails

      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          amountUsdc: '500.000000',
          externalRefSource: 'manual',
          externalRef: 'stake-2024-01-15-002',
        })
        .expect(202)

      expect(response.body.success).toBe(true)
      expect(response.body.status).toBe(OutboxStatus.PENDING)
      expect(response.body.message).toBe('Staking confirmed, receipt queued for retry')

      sendSpy.mockRestore()
    })

    it('should be idempotent - same external ref returns existing receipt', async () => {
      const payload = {
        amountUsdc: '1000.000000',
        externalRefSource: 'manual',
        externalRef: 'stake-2024-01-15-003',
      }

      const response1 = await request(app)
        .post('/api/staking/stake')
        .send(payload)
        .expect(200)

      const response2 = await request(app)
        .post('/api/staking/stake')
        .send(payload)
        .expect(200)

      expect(response1.body.txId).toBe(response2.body.txId)
      expect(response1.body.outboxId).toBe(response2.body.outboxId)
    })

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          // Missing required fields
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('should reject invalid amount format', async () => {
      const response = await request(app)
        .post('/api/staking/stake')
        .send({
          amountUsdc: 'invalid',
          externalRefSource: 'manual',
          externalRef: 'stake-2024-01-15-004',
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /api/staking/unstake', () => {
    it('should unstake tokens successfully', async () => {
      const response = await request(app)
        .post('/api/staking/unstake')
        .send({
          amountUsdc: '500.000000',
          externalRefSource: 'manual',
          externalRef: 'unstake-2024-01-15-001',
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.outboxId).toBeDefined()
      expect(response.body.txId).toMatch(/^[a-f0-9]{64}$/)
      expect(response.body.status).toBe(OutboxStatus.SENT)
      expect(response.body.message).toBe('Unstaking confirmed and receipt written to chain')
    })

    it('should be idempotent - same external ref returns existing receipt', async () => {
      const payload = {
        amountUsdc: '500.000000',
        externalRefSource: 'manual',
        externalRef: 'unstake-2024-01-15-002',
      }

      const response1 = await request(app)
        .post('/api/staking/unstake')
        .send(payload)
        .expect(200)

      const response2 = await request(app)
        .post('/api/staking/unstake')
        .send(payload)
        .expect(200)

      expect(response1.body.txId).toBe(response2.body.txId)
    })

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/staking/unstake')
        .send({
          // Missing required fields
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /api/staking/claim', () => {
    it('should claim staking rewards successfully', async () => {
      const response = await request(app)
        .post('/api/staking/claim')
        .send({
          externalRefSource: 'manual',
          externalRef: 'claim-2024-01-15-001',
        })
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.outboxId).toBeDefined()
      expect(response.body.txId).toMatch(/^[a-f0-9]{64}$/)
      expect(response.body.status).toBe(OutboxStatus.SENT)
      expect(response.body.message).toBe('Staking reward claim confirmed and receipt written to chain')
    })

    it('should be idempotent - same external ref returns existing receipt', async () => {
      const payload = {
        externalRefSource: 'manual',
        externalRef: 'claim-2024-01-15-002',
      }

      const response1 = await request(app)
        .post('/api/staking/claim')
        .send(payload)
        .expect(200)

      const response2 = await request(app)
        .post('/api/staking/claim')
        .send(payload)
        .expect(200)

      expect(response1.body.txId).toBe(response2.body.txId)
    })

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/staking/claim')
        .send({
          // Missing required fields
        })
        .expect(400)

      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /api/staking/position', () => {
    it('should return staking position', async () => {
      const response = await request(app)
        .get('/api/staking/position')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.position).toBeDefined()
      expect(response.body.position.staked).toMatch(/^\d+(\.\d{1,6})?$/)
      expect(response.body.position.claimable).toMatch(/^\d+(\.\d{1,6})?$/)
    })
  })
})
