import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createInspectorJobsRouter } from './inspectorJobs.js'
import { StubSorobanAdapter } from '../soroban/stub-adapter.js'
import { errorHandler } from '../middleware/errorHandler.js'

vi.mock('../middleware/auth.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth.js')>()
  return {
    ...original,
    authenticateToken: (req: any, _res: any, next: any) => next(),
  }
})

vi.mock('../services/inspectorService.js', () => ({
  inspectorService: {
    listAvailableJobs: vi.fn().mockResolvedValue([]),
    claimJob: vi.fn().mockResolvedValue({ id: 'job-abc-123', listingId: 'listing-1' }),
    submitReport: vi.fn(),
    listAllJobs: vi.fn().mockResolvedValue([]),
    createJob: vi.fn(),
    approveReport: vi.fn(),
    rejectReport: vi.fn(),
  },
}))

const INSPECTOR_ID = 'inspector-test-user-001'

function buildApp(role: string = 'inspector') {
  const adapter = new StubSorobanAdapter({ rpcUrl: '', networkPassphrase: '' })
  const app = express()
  app.use(express.json())
  // Inject a fake authenticated user so we can test bond logic without Postgres auth
  app.use((req: any, _res, next) => {
    req.user = { id: INSPECTOR_ID, role }
    next()
  })
  app.use('/api/v1/inspector', createInspectorJobsRouter(adapter))
  app.use(errorHandler)
  return app
}

describe('Inspector Jobs API', () => {
  beforeEach(() => {
    StubSorobanAdapter._testOnlyReset()
  })

  describe('POST /api/v1/inspector/bond/stake', () => {
    it('stakes a bond for an authenticated inspector', async () => {
      const res = await request(buildApp())
        .post('/api/v1/inspector/bond/stake')
        .send({ amount: '500' })
        .expect(200)

      expect(res.body.success).toBe(true)
    })

    it('returns 400 when amount is missing', async () => {
      await request(buildApp())
        .post('/api/v1/inspector/bond/stake')
        .send({})
        .expect(400)
    })

    it('returns 403 when user is not an inspector', async () => {
      await request(buildApp('tenant'))
        .post('/api/v1/inspector/bond/stake')
        .send({ amount: '500' })
        .expect(403)
    })
  })

  describe('DELETE /api/v1/inspector/bond/unstake', () => {
    it('unstakes an existing bond', async () => {
      const app = buildApp()

      await request(app)
        .post('/api/v1/inspector/bond/stake')
        .send({ amount: '500' })
        .expect(200)

      const res = await request(app)
        .delete('/api/v1/inspector/bond/unstake')
        .expect(200)

      expect(res.body.success).toBe(true)
    })

    it('returns 400 when inspector has no active bond', async () => {
      await request(buildApp())
        .delete('/api/v1/inspector/bond/unstake')
        .expect(400)
    })
  })

  describe('GET /api/v1/inspector/bond/status', () => {
    it('returns not bonded when no stake exists', async () => {
      const res = await request(buildApp())
        .get('/api/v1/inspector/bond/status')
        .expect(200)

      expect(res.body.isBonded).toBe(false)
      expect(res.body.amount).toBe('0')
    })

    it('returns bonded status after staking', async () => {
      const app = buildApp()

      await request(app)
        .post('/api/v1/inspector/bond/stake')
        .send({ amount: '1000' })
        .expect(200)

      const res = await request(app)
        .get('/api/v1/inspector/bond/status')
        .expect(200)

      expect(res.body.isBonded).toBe(true)
      expect(res.body.amount).toBe('1000')
    })
  })

  describe('POST /api/v1/inspector/jobs/:id/claim', () => {
    it('allows a bonded inspector to claim a job', async () => {
      const app = buildApp()

      await request(app)
        .post('/api/v1/inspector/bond/stake')
        .send({ amount: '500' })
        .expect(200)

      const res = await request(app)
        .post('/api/v1/inspector/jobs/job-abc-123/claim')
        .expect(200)

      expect(res.body.success).toBe(true)
    })

    it('returns 403 when inspector has no bond', async () => {
      await request(buildApp())
        .post('/api/v1/inspector/jobs/job-xyz-456/claim')
        .expect(403)
    })

    it('stake → unstake → claim returns 403', async () => {
      const app = buildApp()

      await request(app)
        .post('/api/v1/inspector/bond/stake')
        .send({ amount: '500' })
        .expect(200)

      await request(app)
        .delete('/api/v1/inspector/bond/unstake')
        .expect(200)

      await request(app)
        .post('/api/v1/inspector/jobs/job-round-trip/claim')
        .expect(403)
    })
  })
})
