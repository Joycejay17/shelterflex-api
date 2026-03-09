import { Router, Request, Response, NextFunction } from 'express'
import { ReceiptRepository } from '../indexer/receipt-repository.js'
import { TxType } from '../outbox/types.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken } from '../middleware/auth.js'

const VALID_TX_TYPES = new Set(Object.values(TxType))

/**
 * @openapi
 * /api/admin/receipts:
 *   get:
 *     summary: Query indexed receipts (no Soroban call)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: dealId,   schema: { type: string } }
 *       - { in: query, name: txType,   schema: { type: string } }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 20, maximum: 100 } }
 *     responses:
 *       200: { description: Paged receipts }
 *       401: { description: Unauthorized }
 * /api/deals/{dealId}/receipts:
 *   get:
 *     summary: All receipts for a deal
 *     tags: [Deals]
 *     parameters:
 *       - { in: path, name: dealId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Receipt list }
 */
export function createReceiptsRouter(repo: ReceiptRepository): Router {
  const router = Router()

  router.get(
    '/admin/receipts',
    authenticateToken,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
        const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20))
        const dealId = req.query.dealId as string | undefined
        const rawTxType = req.query.txType as string | undefined

        if (rawTxType !== undefined && !VALID_TX_TYPES.has(rawTxType as TxType)) {
          return next(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              400,
              `Invalid txType. Must be one of: ${[...VALID_TX_TYPES].join(', ')}`,
            ),
          )
        }

        const txType = rawTxType as TxType | undefined
        res.json(await repo.query({ dealId, txType, page, pageSize }))
      } catch (err) {
        next(err)
      }
    },
  )

  router.get('/deals/:dealId/receipts', async (req: Request, res: Response, next: NextFunction) => {
    const { dealId } = req.params
    if (!dealId) return next(new AppError(ErrorCode.VALIDATION_ERROR, 400, 'dealId is required'))
    try {
      const receipts = await repo.findByDealId(dealId)
      res.json({ dealId, receipts, total: receipts.length })
    } catch (err) {
      next(err)
    }
  })

  return router
}