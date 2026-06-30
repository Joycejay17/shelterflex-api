import express from 'express'
import request from 'supertest'
import { describe, it, expect } from 'vitest'
import publicRouter from './publicRoutes.js'
import { env } from '../schemas/env.js'

const app = express()
app.use(express.json())
app.use(publicRouter)

describe('Public Routes', () => {
  describe('GET /soroban/config', () => {
    it('returns rpcUrl, networkPassphrase, and contractId fields', async () => {
      const res = await request(app).get('/soroban/config').expect(200)

      expect(res.body).toHaveProperty('rpcUrl')
      expect(res.body).toHaveProperty('networkPassphrase')
      expect(res.body).toHaveProperty('contractId')
    })

    it('rpcUrl matches the configured env value', async () => {
      const res = await request(app).get('/soroban/config').expect(200)

      expect(res.body.rpcUrl).toBe(env.SOROBAN_RPC_URL)
    })

    it('networkPassphrase matches the configured env value', async () => {
      const res = await request(app).get('/soroban/config').expect(200)

      expect(res.body.networkPassphrase).toBe(env.SOROBAN_NETWORK_PASSPHRASE)
    })

    it('returns null for contractId when SOROBAN_CONTRACT_ID is not set', async () => {
      const res = await request(app).get('/soroban/config').expect(200)

      expect(res.body.contractId).toBeNull()
    })

    it('response has no extra undocumented fields', async () => {
      const res = await request(app).get('/soroban/config').expect(200)

      expect(Object.keys(res.body).sort()).toEqual(['contractId', 'networkPassphrase', 'rpcUrl'])
    })
  })

  describe('POST /api/example/echo', () => {
    it('echoes the message and includes receivedAt timestamp', async () => {
      const res = await request(app)
        .post('/api/example/echo')
        .send({ message: 'hello world' })
        .expect(200)

      expect(res.body.echo).toBe('hello world')
      expect(res.body.receivedAt).toBeDefined()
      expect(new Date(res.body.receivedAt).getTime()).toBeGreaterThan(0)
    })

    it('includes originalTimestamp when provided', async () => {
      const ts = Date.now()

      const res = await request(app)
        .post('/api/example/echo')
        .send({ message: 'with timestamp', timestamp: ts })
        .expect(200)

      expect(res.body.originalTimestamp).toBe(ts)
    })

    it('omits originalTimestamp when not provided', async () => {
      const res = await request(app)
        .post('/api/example/echo')
        .send({ message: 'no timestamp' })
        .expect(200)

      expect(res.body).not.toHaveProperty('originalTimestamp')
    })

    it('returns 400 when message is missing', async () => {
      const res = await request(app)
        .post('/api/example/echo')
        .send({})
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when message is an empty string', async () => {
      const res = await request(app)
        .post('/api/example/echo')
        .send({ message: '' })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when message exceeds 100 characters', async () => {
      const res = await request(app)
        .post('/api/example/echo')
        .send({ message: 'x'.repeat(101) })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when timestamp is not a positive integer', async () => {
      const res = await request(app)
        .post('/api/example/echo')
        .send({ message: 'valid', timestamp: -1 })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
