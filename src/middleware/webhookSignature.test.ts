import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import {
  verifyPaystackSignature,
  verifyFlutterwaveSignature,
  preventWebhookReplay,
  _testOnlyClearWebhookReplayCache,
} from '../middleware/webhookSignature.js'
import { AppError } from '../errors/AppError.js'

function mockReq(
  overrides: Partial<Request> & { rawBody?: Buffer | string; body?: unknown } = {},
): Request {
  return {
    headers: {},
    body: {},
    ...overrides,
  } as Request
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response
}

describe('webhookSignature middleware', () => {
  const secret = 'paystack_test_secret'
  const flwHash = 'flutterwave_secret_hash_value'

  beforeEach(() => {
    _testOnlyClearWebhookReplayCache()
    process.env.PAYSTACK_SECRET_KEY = secret
    process.env.FLUTTERWAVE_SECRET_HASH = flwHash
    process.env.NODE_ENV = 'test'
  })

  it('accepts valid Paystack signature', () => {
    const payload = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 'evt-1' } }))
    const signature = crypto.createHmac('sha512', secret).update(payload).digest('hex')
    const req = mockReq({
      headers: { 'x-paystack-signature': signature },
      rawBody: payload,
    })
    const next = vi.fn()

    verifyPaystackSignature(req, mockRes(), next)
    expect(next).toHaveBeenCalledWith()
  })

  it('rejects tampered Paystack body', () => {
    const payload = Buffer.from(JSON.stringify({ event: 'charge.success' }))
    const signature = crypto.createHmac('sha512', secret).update(payload).digest('hex')
    const req = mockReq({
      headers: { 'x-paystack-signature': signature },
      rawBody: Buffer.from(JSON.stringify({ event: 'charge.failed' })),
    })
    const next = vi.fn()

    verifyPaystackSignature(req, mockRes(), next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const err = next.mock.calls[0][0] as AppError
    expect(err.status).toBe(401)
  })

  it('rejects missing Paystack header', () => {
    const next = vi.fn()
    verifyPaystackSignature(mockReq({ rawBody: Buffer.from('{}') }), mockRes(), next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
  })

  it('accepts valid Flutterwave verif-hash', () => {
    const req = mockReq({ headers: { 'verif-hash': flwHash } })
    const next = vi.fn()
    verifyFlutterwaveSignature(req, mockRes(), next)
    expect(next).toHaveBeenCalledWith()
  })

  it('rejects invalid Flutterwave verif-hash', () => {
    const req = mockReq({ headers: { 'verif-hash': 'wrong' } })
    const next = vi.fn()
    verifyFlutterwaveSignature(req, mockRes(), next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
  })

  it('returns 200 for duplicate event id without re-processing', () => {
    const req = mockReq({
      body: { id: 'evt-dup', data: { reference: 'ref-1' } },
    })
    const res = mockRes()
    const next = vi.fn()

    preventWebhookReplay('paystack')(req, res, next)
    expect(next).toHaveBeenCalled()

    const req2 = mockReq({
      body: { id: 'evt-dup', data: { reference: 'ref-1' } },
    })
    const res2 = mockRes()
    const next2 = vi.fn()

    preventWebhookReplay('paystack')(req2, res2, next2)
    expect(next2).not.toHaveBeenCalled()
    expect(res2.status).toHaveBeenCalledWith(200)
    expect(req2.webhookReplaySkipped).toBe(true)
  })
})
