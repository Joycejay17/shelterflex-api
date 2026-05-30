import type { Request, Response, NextFunction } from 'express'
import { isEnabled } from '../services/featureFlags.js'
import type { FlagName } from '../config/featureFlags.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import type { AuthenticatedRequest } from './auth.js'

/**
 * Express middleware that blocks a route when the given feature flag is disabled.
 *
 * Usage:
 *   app.use('/api/staking', requireFlag('STAKING_ENABLED'), createStakingRouter(...))
 *
 * If the flag is off the request receives 403 {"success":false,"error":"Feature '…' is not enabled"}.
 * When the flag is on, the middleware calls next() immediately.
 */
export function requireFlag(flag: FlagName) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest
    const context = authReq.user
      ? { userId: authReq.user.id, role: authReq.user.role }
      : undefined

    if (!isEnabled(flag, context)) {
      next(
        new AppError(
          ErrorCode.FORBIDDEN,
          403,
          `Feature '${flag}' is not enabled`,
        ),
      )
      return
    }
    next()
  }
}
