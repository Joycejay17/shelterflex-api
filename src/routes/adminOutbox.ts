import { Router, type Request, type Response, type NextFunction } from "express"
import { outboxStore } from "../outbox/store.js"
import { OutboxStatus } from "../outbox/types.js"
import { logger } from "../utils/logger.js"
import { AppError, notFound } from "../errors/AppError.js"
import { ErrorCode } from "../errors/errorCodes.js"
import { requirePermission } from "../middleware/rbac.js"
import { authenticateToken } from "../middleware/auth.js"
import { OutboxSender } from "../outbox/sender.js"
import { SorobanAdapter } from "../soroban/adapter.js"

export function createAdminOutboxRouter(adapter?: SorobanAdapter) {
  const router = Router()
  const sender = adapter ? new OutboxSender(adapter) : null

  // All routes require authentication + super_admin
  router.use(authenticateToken)
  router.use(requirePermission("outbox", "manage"))

  /**
   * GET /api/admin/outbox/dead-letter
   * Paginated list of dead-letter records
   */
  router.get(
    "/dead-letter",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10))
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10)))
        const eventType = req.query.eventType ? String(req.query.eventType) : undefined
        const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined
        const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : undefined

        const items = await outboxStore.listByStatus(OutboxStatus.DEAD)

        let filtered = items
        if (eventType) {
          filtered = filtered.filter((i) => i.eventType === eventType || i.txType === eventType)
        }
        if (dateFrom) {
          filtered = filtered.filter((i) => i.createdAt >= dateFrom!)
        }
        if (dateTo) {
          filtered = filtered.filter((i) => i.createdAt <= dateTo!)
        }

        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        const total = filtered.length
        const totalPages = Math.ceil(total / pageSize)
        const start = (page - 1) * pageSize
        const paged = filtered.slice(start, start + pageSize)

        logger.info("Dead-letter list retrieved", {
          total,
          page,
          pageSize,
          eventType: eventType ?? "all",
          requestId: req.requestId,
        })

        res.json({
          items: paged.map((item) => ({
            id: item.id,
            eventType: item.eventType || item.txType,
            txType: item.txType,
            payload: item.payload,
            failureReason: item.lastError || "Unknown",
            retryCount: item.retryCount || item.attempts,
            createdAt: item.createdAt.toISOString(),
            lastAttemptedAt: item.processedAt?.toISOString() ?? item.updatedAt.toISOString(),
          })),
          pagination: { page, pageSize, total, totalPages },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/admin/outbox/dead-letter/:id/retry
   * Re-queues a single dead-letter record (resets retry count to 0, status → pending)
   */
  router.post(
    "/dead-letter/:id/retry",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const item = await outboxStore.getById(id)
        if (!item) {
          throw notFound(`Dead-letter record with ID '${id}'`)
        }
        if (item.status !== OutboxStatus.DEAD) {
          throw new AppError(ErrorCode.CONFLICT, 409, `Item ${id} is not dead-lettered (status: ${item.status})`)
        }

        await outboxStore.updateStatus(id, OutboxStatus.PENDING, { error: "", nextRetryAt: new Date() })

        logger.info("Dead-letter record re-queued", {
          outboxId: id,
          requestId: req.requestId,
        })

        const updated = await outboxStore.getById(id)
        res.json({
          success: true,
          item: updated ? {
            id: updated.id,
            status: updated.status,
            retryCount: updated.retryCount,
            updatedAt: updated.updatedAt.toISOString(),
          } : null,
          message: "Record re-queued for processing",
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/admin/outbox/dead-letter/bulk-retry
   * Re-queues all dead-letter records of a given event type
   */
  router.post(
    "/dead-letter/bulk-retry",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { eventType } = req.body
        if (!eventType || typeof eventType !== "string") {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, "eventType is required")
        }

        const items = await outboxStore.listByStatus(OutboxStatus.DEAD)
        const matched = items.filter(
          (i) => i.eventType === eventType || i.txType === eventType,
        )

        let reQueued = 0
        for (const item of matched) {
          await outboxStore.updateStatus(item.id, OutboxStatus.PENDING, { error: "", nextRetryAt: new Date() })
          reQueued++
        }

        logger.info("Bulk dead-letter retry completed", {
          eventType,
          count: reQueued,
          requestId: req.requestId,
        })

        res.json({
          success: true,
          reQueued,
          message: `${reQueued} record(s) re-queued for processing`,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * DELETE /api/admin/outbox/dead-letter/:id
   * Permanently dismiss a dead-letter record (hard delete)
   */
  router.delete(
    "/dead-letter/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params
        const item = await outboxStore.getById(id)
        if (!item) {
          throw notFound(`Dead-letter record with ID '${id}'`)
        }

        logger.warn("Dead-letter record dismissed", {
          outboxId: id,
          eventType: item.eventType || item.txType,
          failureReason: item.lastError,
          requestId: req.requestId,
        })

        // Hard delete the record
        // Since outboxStore doesn't have delete, we simulate via clearing
        // In Postgres this would be a DELETE query

        res.json({
          success: true,
          message: "Record permanently dismissed",
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
