import { Router, type Request, type Response, type NextFunction } from 'express'
import { validate } from '../middleware/validate.js'
import { paymentsWebhookSchema } from '../schemas/deposit.js'
import { depositReversalWebhookSchema } from '../schemas/risk.js'
import { depositStore } from '../models/depositStore.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { outboxStore, OutboxSender, TxType } from '../outbox/index.js'
import { createSorobanAdapter } from '../soroban/index.js'
import { getSorobanConfigFromEnv } from '../soroban/client.js'
import { NgnWalletService } from '../services/ngnWalletService.js'

export function createWebhooksRouter(ngnWalletService: NgnWalletService) {
  const router = Router()
  const adapter = createSorobanAdapter(getSorobanConfigFromEnv(process.env))
  const sender = new OutboxSender(adapter)

  router.post(
    '/payments/:rail',
    validate(paymentsWebhookSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rail = String(req.params.rail)
        if (process.env.WEBHOOK_SIGNATURE_ENABLED === 'true') {
          const sig = req.headers['x-webhook-signature']
          if (typeof sig !== 'string' || sig !== process.env.WEBHOOK_SECRET) {
            throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid webhook signature')
          }
        }

        const { externalRefSource, externalRef, status } = req.body
        if (externalRefSource !== rail) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Rail mismatch')
        }

        const existing = await depositStore.getByCanonical(rail, externalRef)
        if (!existing) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Deposit not found')
        }

        if (status === 'failed') {
          await depositStore.fail(existing.depositId)
          logger.warn('Deposit failed via webhook', {
            depositId: existing.depositId,
            rail,
            externalRef,
            requestId: req.requestId,
          })
          return res.status(200).json({ success: true })
        }

        const confirmed = await depositStore.confirmByCanonical(rail, externalRef)

        if (confirmed && confirmed.confirmedAt) {
          const amountUsdc = String(Math.round((confirmed.amountNgn / 1600) * 1e6) / 1e6)
          const outboxItem = await outboxStore.create({
            txType: TxType.STAKE,
            source: 'deposit',
            ref: confirmed.depositId,
            payload: {
              txType: TxType.STAKE,
              amountUsdc,
            },
          })
          await sender.send(outboxItem)
        }

        logger.info('Deposit confirmed via webhook', {
          depositId: existing.depositId,
          rail,
          externalRef,
          requestId: req.requestId,
        })
        res.status(200).json({ success: true })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/webhooks/reversals/:provider
   * Handle deposit reversal/chargeback webhooks
   * Idempotent based on (provider, providerRef, eventType)
   */
  router.post(
    '/reversals/:provider',
    validate(depositReversalWebhookSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const provider = String(req.params.provider)
        
        // Verify webhook signature if enabled
        if (process.env.WEBHOOK_SIGNATURE_ENABLED === 'true') {
          const sig = req.headers['x-webhook-signature']
          if (typeof sig !== 'string' || sig !== process.env.WEBHOOK_SECRET) {
            throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid webhook signature')
          }
        }

        const { provider: bodyProvider, providerRef, reversalRef, eventType } = req.body
        
        if (bodyProvider !== provider) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Provider mismatch')
        }

        if (eventType !== 'deposit.reversed') {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid event type')
        }

        logger.info('Processing deposit reversal webhook', {
          provider,
          providerRef,
          reversalRef,
          requestId: req.requestId,
        })

        // Process the reversal (idempotent)
        await ngnWalletService.processDepositReversal(provider, providerRef, reversalRef)

        logger.info('Deposit reversal processed successfully', {
          provider,
          providerRef,
          reversalRef,
          requestId: req.requestId,
        })

        res.status(200).json({ success: true })
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) {
          // If deposit not found, still return 200 to prevent webhook retries
          logger.warn('Deposit not found for reversal webhook', {
            provider: req.params.provider,
            body: req.body,
            requestId: req.requestId,
          })
          res.status(200).json({ success: true, message: 'Deposit not found' })
          return
        }
        next(error)
      }
    },
  )

  return router
}
