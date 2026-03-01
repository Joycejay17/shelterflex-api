import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { confirmPaymentSchema } from '../schemas/payment.js'
import { outboxStore, OutboxSender, TxType } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'

export function createPaymentsRouter(adapter: SorobanAdapter) {
  const router = Router()
  const sender = new OutboxSender(adapter)

  /**
   * POST /api/payments/confirm
   * 
   * Confirm an off-chain payment and queue on-chain receipt
   * 
   * Flow:
   * 1. Validate request
   * 2. Compute tx_id using canonicalization rules
   * 3. Persist outbox item (idempotent - returns existing if duplicate)
   * 4. Attempt immediate send
   * 5. If send fails, keep as pending/failed for retry
   */
  router.post('/confirm', validate(confirmPaymentSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { externalRef, dealId, amount, payer } = req.body

      logger.info('Payment confirmation requested', {
        externalRef,
        dealId,
        amount,
        payer,
        requestId: req.requestId,
      })

      // Create outbox item (idempotent)
      const outboxItem = await outboxStore.create({
        txType: TxType.RECEIPT,
        canonicalExternalRefV1: externalRef,
        payload: {
          dealId,
          amount,
          payer,
        },
      })

      logger.info('Outbox item created', {
        outboxId: outboxItem.id,
        txId: outboxItem.txId,
        status: outboxItem.status,
      })

      // Attempt immediate send
      const sent = await sender.send(outboxItem)

      // Fetch updated item to get latest status
      const updatedItem = await outboxStore.getById(outboxItem.id)
      if (!updatedItem) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          500,
          'Failed to retrieve outbox item after send attempt',
        )
      }

      res.status(sent ? 200 : 202).json({
        success: true,
        outboxId: updatedItem.id,
        txId: updatedItem.txId,
        status: updatedItem.status,
        message: sent
          ? 'Payment confirmed and receipt written to chain'
          : 'Payment confirmed, receipt queued for retry',
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
