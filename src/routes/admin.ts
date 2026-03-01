import { Router, type Request, type Response, type NextFunction } from 'express'
import { outboxStore, OutboxSender, OutboxStatus } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createAdminRouter(adapter: SorobanAdapter) {
  const router = Router()
  const sender = new OutboxSender(adapter)

  /**
   * GET /api/admin/outbox
   * 
   * List outbox items, optionally filtered by status
   * Query params:
   *   - status: pending | sent | failed (optional)
   *   - limit: number (optional, default 100)
   */
  router.get('/outbox', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, limit } = req.query
      const limitNum = limit ? parseInt(String(limit), 10) : 100

      if (limitNum < 1 || limitNum > 1000) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          400,
          'Limit must be between 1 and 1000',
        )
      }

      let items

      if (status) {
        // Validate status
        if (!Object.values(OutboxStatus).includes(status as OutboxStatus)) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            400,
            `Invalid status. Must be one of: ${Object.values(OutboxStatus).join(', ')}`,
          )
        }

        items = await outboxStore.listByStatus(status as OutboxStatus)
      } else {
        items = await outboxStore.listAll(limitNum)
      }

      logger.info('Outbox items retrieved', {
        count: items.length,
        status: status || 'all',
        requestId: req.requestId,
      })

      res.json({
        items: items.map((item) => ({
          id: item.id,
          txType: item.txType,
          txId: item.txId,
          externalRef: item.canonicalExternalRefV1,
          status: item.status,
          attempts: item.attempts,
          lastError: item.lastError,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          payload: item.payload,
        })),
        total: items.length,
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/outbox/:id/retry
   * 
   * Retry a specific outbox item
   */
  router.post('/outbox/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params

      logger.info('Manual retry requested', {
        outboxId: id,
        requestId: req.requestId,
      })

      const item = await outboxStore.getById(id)
      if (!item) {
        throw new AppError(ErrorCode.NOT_FOUND, 404, `Outbox item not found: ${id}`)
      }

      const success = await sender.retry(id)

      // Fetch updated item
      const updatedItem = await outboxStore.getById(id)
      if (!updatedItem) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          500,
          'Failed to retrieve outbox item after retry',
        )
      }

      res.json({
        success,
        item: {
          id: updatedItem.id,
          txId: updatedItem.txId,
          status: updatedItem.status,
          attempts: updatedItem.attempts,
          lastError: updatedItem.lastError,
          updatedAt: updatedItem.updatedAt.toISOString(),
        },
        message: success
          ? 'Retry successful, receipt written to chain'
          : 'Retry failed, item remains in failed state',
      })
    } catch (error) {
      next(error)
    }
  })

  /**
   * POST /api/admin/outbox/retry-all
   * 
   * Retry all failed outbox items
   */
  router.post('/outbox/retry-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Retry all failed items requested', {
        requestId: req.requestId,
      })

      const result = await sender.retryAll()

      logger.info('Retry all completed', {
        succeeded: result.succeeded,
        failed: result.failed,
        requestId: req.requestId,
      })

      res.json({
        success: true,
        succeeded: result.succeeded,
        failed: result.failed,
        message: `Retried ${result.succeeded + result.failed} items: ${result.succeeded} succeeded, ${result.failed} failed`,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
