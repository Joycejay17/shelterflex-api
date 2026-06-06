import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { softDeleteUser } from '../services/dataRetentionService.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

export function createAccountRouter() {
  const router = Router()

  /**
   * DELETE /api/account
   * Soft delete the authenticated user's account and all associated records
   * Returns 204 No Content on success
   */
  router.delete(
    '/account',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
        }

        const result = await softDeleteUser(
          userId,
          userId,
          req.user?.role || 'tenant',
          req.requestId
        )

        if (!result.success) {
          throw new AppError(ErrorCode.INTERNAL_ERROR, 500, result.error || 'Failed to delete account')
        }

        res.status(204).send()
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}
