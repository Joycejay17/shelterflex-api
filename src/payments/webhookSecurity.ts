import crypto from 'node:crypto'
import type { Request } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export const DEFAULT_WEBHOOK_FRESHNESS_SECONDS = 5 * 60

export function getWebhookFreshnessSeconds(): number {
  const configured = Number(process.env.WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_WEBHOOK_FRESHNESS_SECONDS
}

export function getSignedWebhookTimestamp(req: Request): string {
  const header = req.headers['x-webhook-timestamp']
  const timestamp = Array.isArray(header) ? header[0] : header
  if (!timestamp) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      401,
      'Missing x-webhook-timestamp header',
    )
  }
  return timestamp
}

export function assertFreshWebhookTimestamp(
  timestamp: string,
  nowMs = Date.now(),
  toleranceSeconds = getWebhookFreshnessSeconds(),
): void {
  const numericTimestamp = Number(timestamp)
  const timestampMs = Number.isFinite(numericTimestamp)
    ? numericTimestamp < 10_000_000_000
      ? numericTimestamp * 1000
      : numericTimestamp
    : Date.parse(timestamp)

  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(nowMs - timestampMs) > toleranceSeconds * 1000
  ) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      401,
      `Webhook timestamp is outside the ${toleranceSeconds}-second freshness window`,
    )
  }
}

export function timestampedWebhookPayload(
  timestamp: string,
  rawBody: string | Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from(timestamp, 'utf8'),
    Buffer.from('.', 'utf8'),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'),
  ])
}

/**
 * Compares a supplied value with an expected value while always invoking
 * timingSafeEqual on equal-length buffers, including malformed/short input.
 */
export function constantTimeEqual(
  supplied: string,
  expected: string,
  encoding: BufferEncoding = 'utf8',
): boolean {
  const expectedBuffer = Buffer.from(expected, encoding)
  let suppliedBuffer: Buffer
  let validEncoding = true

  if (encoding === 'hex' && !/^(?:[0-9a-fA-F]{2})+$/.test(supplied)) {
    suppliedBuffer = Buffer.alloc(0)
    validEncoding = false
  } else {
    suppliedBuffer = Buffer.from(supplied, encoding)
  }

  const normalized = Buffer.alloc(expectedBuffer.length)
  suppliedBuffer.copy(normalized, 0, 0, expectedBuffer.length)
  const equal = crypto.timingSafeEqual(normalized, expectedBuffer)

  return validEncoding && suppliedBuffer.length === expectedBuffer.length && equal
}

