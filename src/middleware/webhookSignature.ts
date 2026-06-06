import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { LRUCache } from 'lru-cache'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

declare global {
  namespace Express {
    interface Request {
      rawBody?: string | Buffer
      webhookReplaySkipped?: boolean
    }
  }
}

const REPLAY_TTL_MS = 60 * 60 * 1000

const processedEventIds = new LRUCache<string, true>({
  max: 10_000,
  ttl: REPLAY_TTL_MS,
})

function getPaystackSecret(): string | undefined {
  return process.env.PAYSTACK_SECRET_KEY ?? process.env.PAYSTACK_SECRET
}

function getFlutterwaveSecretHash(): string | undefined {
  return process.env.FLUTTERWAVE_SECRET_HASH ?? process.env.FLUTTERWAVE_SECRET
}

export function getRawBodyBuffer(req: Request): Buffer {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody
  }
  if (typeof req.rawBody === 'string') {
    return Buffer.from(req.rawBody, 'utf8')
  }
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8')
  }
  return Buffer.alloc(0)
}

export function verifyPaystackSignature(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const secret = getPaystackSecret()
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'PAYSTACK_SECRET_KEY not configured')
      }
      return next()
    }

    const signature = req.headers['x-paystack-signature'] as string | undefined
    if (!signature) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Missing x-paystack-signature header')
    }

    const rawBody = getRawBodyBuffer(req)
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex')

    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
    ) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid Paystack signature')
    }

    next()
  } catch (error) {
    next(error)
  }
}

export function verifyFlutterwaveSignature(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    const secretHash = getFlutterwaveSecretHash()
    if (!secretHash) {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'FLUTTERWAVE_SECRET_HASH not configured')
      }
      return next()
    }

    const verifHash = req.headers['verif-hash'] as string | undefined
    if (!verifHash) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Missing verif-hash header')
    }

    const a = Buffer.from(verifHash, 'utf8')
    const b = Buffer.from(secretHash, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid Flutterwave signature')
    }

    next()
  } catch (error) {
    next(error)
  }
}

function extractEventId(req: Request, rail: string): string | undefined {
  const body = req.body as Record<string, unknown> | undefined
  if (!body) return undefined

  if (rail === 'paystack') {
    const data = body.data as Record<string, unknown> | undefined
    return String(body.id ?? data?.id ?? data?.reference ?? '')
  }
  if (rail === 'flutterwave') {
    const data = body.data as Record<string, unknown> | undefined
    return String(body.id ?? data?.id ?? data?.tx_ref ?? '')
  }
  return String(body.externalRef ?? body.id ?? '')
}

/**
 * Short-lived replay cache — duplicate event IDs return 200 without re-processing.
 */
export function preventWebhookReplay(rail: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const eventId = extractEventId(req, rail)
    if (!eventId) {
      return next()
    }

    const cacheKey = `${rail}:${eventId}`
    if (processedEventIds.has(cacheKey)) {
      req.webhookReplaySkipped = true
      logger.info('Webhook replay suppressed (short-lived cache)', { rail, eventId })
      res.status(200).json({ success: true, deduped: true, providerEventId: eventId })
      return
    }

    processedEventIds.set(cacheKey, true)
    next()
  }
}

export function _testOnlyClearWebhookReplayCache(): void {
  processedEventIds.clear()
}
