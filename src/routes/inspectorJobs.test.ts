import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { StubSorobanAdapter } from '../soroban/stub-adapter.js'

describe('Inspector Jobs API', () => {
  let app: any

  beforeEach(async () => {
    StubSorobanAdapter._testOnlyReset()
    app = createApp()
  })

  const INSPECTOR_ID = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

  describe('POST /api/inspector/bond/stake', () => {
    it('stakes a bond for an inspector', async () => {
      const res = await request(app)
        .post('/api/inspector/bond/stake')
        .set('x-inspector-id', INSPECTOR_ID)
        .send({ amount: '500' })
        .expect(200)

      expect(res.body.success).toBe(true)
    })

    it('returns 400 when amount is missing', async () => {
      await request(app)
        .post('/api/inspector/bond/stake')
        .set('x-inspector-id', INSPECTOR_ID)
        .send({})
        .expect(400)
    })

    it('returns 400 when x-inspector-id header is missing', async () => {
      await request(app)
        .post('/api/inspector/bond/stake')
        .send({ amount: '500' })
        .expect(400)
    })
  })

  describe('DELETE /api/inspector/bond/unstake', () => {
    it('unstakes an existing bond', async () => {
      await request(app)
        .post('/api/inspector/bond/stake')
        .set('x-inspector-id', INSPECTOR_ID)
        .send({ amount: '500' })
        .expect(200)

      const res = await request(app)
        .delete('/api/inspector/bond/unstake')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(200)

      expect(res.body.success).toBe(true)
    })

    it('returns 400 when inspector has no active bond', async () => {
      await request(app)
        .delete('/api/inspector/bond/unstake')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(400)
    })
  })

  describe('GET /api/inspector/bond/status', () => {
    it('returns not bonded when no stake exists', async () => {
      const res = await request(app)
        .get('/api/inspector/bond/status')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(200)

      expect(res.body.isBonded).toBe(false)
      expect(res.body.amount).toBe('0')
    })

    it('returns bonded status after staking', async () => {
      await request(app)
        .post('/api/inspector/bond/stake')
        .set('x-inspector-id', INSPECTOR_ID)
        .send({ amount: '1000' })
        .expect(200)

      const res = await request(app)
        .get('/api/inspector/bond/status')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(200)

      expect(res.body.isBonded).toBe(true)
      expect(res.body.amount).toBe('1000')
    })
  })

  describe('POST /api/inspector/jobs/:id/claim', () => {
    it('allows a bonded inspector to claim a job', async () => {
      await request(app)
        .post('/api/inspector/bond/stake')
        .set('x-inspector-id', INSPECTOR_ID)
        .send({ amount: '500' })
        .expect(200)

      const res = await request(app)
        .post('/api/inspector/jobs/job-abc-123/claim')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(200)

      expect(res.body.success).toBe(true)
      expect(res.body.jobId).toBe('job-abc-123')
      expect(res.body.inspectorId).toBe(INSPECTOR_ID)
    })

    it('returns 403 when inspector has no bond', async () => {
      const res = await request(app)
        .post('/api/inspector/jobs/job-xyz-456/claim')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(403)

      expect(res.body).toBeDefined()
    })

    it('stake → unstake → claim returns 403', async () => {
      await request(app)
        .post('/api/inspector/bond/stake')
        .set('x-inspector-id', INSPECTOR_ID)
        .send({ amount: '500' })
        .expect(200)

      await request(app)
        .delete('/api/inspector/bond/unstake')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(200)

      await request(app)
        .post('/api/inspector/jobs/job-round-trip/claim')
        .set('x-inspector-id', INSPECTOR_ID)
        .expect(403)
    })
  })
})
