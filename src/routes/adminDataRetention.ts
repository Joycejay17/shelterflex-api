import { Router, type Request, type Response, type NextFunction } from 'express'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { getPendingPurgeCount, purgeExpiredRecords } from '../services/dataRetentionService.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { logger } from '../utils/logger.js'

/**
 * Check if user has super_admin role
 */
function hasSuperAdminRole(role?: string): boolean {
  return role === 'super_admin'
}

export function createAdminDataRetentionRouter() {
  const router = Router()

  /**
   * GET /api/admin/data-retention/pending-purge
   * Get count of records pending purge (restricted to super_admin)
   */
  router.get(
    '/admin/data-retention/pending-purge',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!hasSuperAdminRole(req.user?.role)) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Super admin access required')
        }

        const counts = await getPendingPurgeCount()
        const totalPending = Object.values(counts).reduce((sum, count) => sum + count, 0)

        res.json({
          totalPending,
          tables: counts,
          retentionPeriodYears: 7,
        })
      } catch (error) {
        next(error)
      }
    }
  )

  /**
   * POST /api/admin/data-retention/purge
   * Manually trigger purge of expired records (restricted to super_admin)
   */
  router.post(
    '/admin/data-retention/purge',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        if (!hasSuperAdminRole(req.user?.role)) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Super admin access required')
        }

        const results = await purgeExpiredRecords()
        const totalDeleted = results.reduce((sum, r) => sum + r.recordsDeleted, 0)

        logger.info('Manual purge triggered by admin', {
          adminUserId: req.user?.id,
          totalDeleted,
          tablesPurged: results.length,
        })

        res.json({
          success: true,
          totalDeleted,
          tables: results,
        })
      } catch (error) {
        next(error)
      }
    }
  )

  return router
}
