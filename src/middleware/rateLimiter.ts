import type { Request, Response, NextFunction } from 'express'
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import { getRedisClient } from '../utils/redis.js'
import { logger } from '../utils/logger.js'
import type { RateLimiterOptions } from '../config/rateLimitConfig.js'

function buildKey(req: Request, keyBy: 'ip' | 'user'): string {
  if (keyBy === 'user') {
    const user = (req as any).user
    const sub = user?.sub ?? user?.id
    if (sub) return `user:${sub}`
  }
  return `ip:${req.ip ?? 'unknown'}`
}

/**
 * Factory that returns an Express middleware backed by RateLimiterRedis.
 * Fails open when Redis is unavailable and emits a warn-level log.
 * 429 responses follow the standard API error envelope:
 *   { success: false, error: { code, message, retryAfter } }
 */
export function createRateLimiter(options: RateLimiterOptions) {
  let limiter: RateLimiterRedis | RateLimiterMemory

  try {
    limiter = new RateLimiterRedis({
      storeClient: getRedisClient(),
      points: options.points,
      duration: options.duration,
      keyPrefix: options.keyPrefix,
      insuranceLimiter: new RateLimiterMemory({
        points: options.points,
        duration: options.duration,
        keyPrefix: `${options.keyPrefix}:mem`,
      }),
    })
  } catch {
    logger.warn('[rateLimiter] Redis unavailable during init — falling back to in-memory limiter')
    limiter = new RateLimiterMemory({
      points: options.points,
      duration: options.duration,
      keyPrefix: options.keyPrefix,
    })
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = buildKey(req, options.keyBy)

    try {
      const result = await limiter.consume(key)
      res.setHeader('X-RateLimit-Limit', options.points)
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints)
      res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + result.msBeforeNext) / 1000))
      next()
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(err.msBeforeNext / 1000)
        res.setHeader('Retry-After', retryAfter)
        res.setHeader('X-RateLimit-Limit', options.points)
        res.setHeader('X-RateLimit-Remaining', 0)
        res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + err.msBeforeNext) / 1000))
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please slow down.',
            retryAfter,
          },
        })
        return
      }

      // Redis or unexpected error — fail open
      logger.warn('[rateLimiter] Redis error, failing open', { error: String(err), key })
      next()
    }
  }
}
