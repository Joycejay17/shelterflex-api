import { Router, type Request, type Response, type NextFunction } from 'express'
import { outboxStore, OutboxSender, TxType } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { depositStore } from '../models/depositStore.js'
import { LinkedAddressStore } from '../models/linkedAddressStore.js'
import { env } from '../schemas/env.js'
import { depositInitiateSchema, type DepositInitiateRequest } from '../schemas/deposit.js'
import { stakeFromDepositSchema, type StakeFromDepositRequest } from '../schemas/stakeFromDeposit.js'
import { stakeFinalizeSchema, type StakeFinalizeRequest } from '../schemas/stakeFinalize.js'
import { conversionStore } from '../models/conversionStore.js'
import { WalletService } from '../services/walletService.js'
import { stakingQuoteSchema, type StakingQuoteRequest } from '../schemas/stakingQuote.js'
import { quoteStore } from '../models/quoteStore.js'
import {
  stakeSchema,
  unstakeSchema,
  claimStakeRewardSchema,
  stakingPositionSchema,
  type StakeRequest,
  type UnstakeRequest,
  type ClaimStakeRewardRequest,
  type StakingPositionResponse,
} from '../schemas/staking.js'

function formatAmount6(amountMicro: bigint): string {
  const negative = amountMicro < 0n
  const abs = negative ? -amountMicro : amountMicro
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`
}

export function createStakingRouter(
  adapter: SorobanAdapter,
  walletService: WalletService,
  linkedAddressStore: LinkedAddressStore,
) {
  const router = Router()
  const sender = new OutboxSender(adapter)

  router.post(
    '/quote',
    authenticateToken,
    validate(stakingQuoteSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { amountNgn, paymentRail } = req.body as StakingQuoteRequest
        const userId = req.user?.id
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
        }
        if (amountNgn <= 0) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'amountNgn must be positive')
        }
        if (amountNgn > env.QUOTE_MAX_AMOUNT_NGN) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Quote amount exceeds maximum')
        }
        const quote = await quoteStore.create({
          userId,
          amountNgn,
          paymentRail,
          fxRateNgnPerUsdc: env.FX_RATE_NGN_PER_USDC,
          feePercent: env.QUOTE_FEE_PERCENT,
          slippagePercent: env.QUOTE_SLIPPAGE_PERCENT,
          expiryMs: env.QUOTE_EXPIRY_MS,
        })
        res.status(201).json({
          quoteId: quote.quoteId,
          amountNgn: quote.amountNgn,
          estimatedAmountUsdc: quote.estimatedAmountUsdc,
          fxRateNgnPerUsdc: quote.fxRateNgnPerUsdc,
          feesNgn: quote.feesNgn,
          expiresAt: quote.expiresAt.toISOString(),
          disclaimer: 'Final USDC may differ slightly due to FX movements',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/deposit/initiate',
    validate(depositInitiateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { quoteId, paymentRail, customerMeta } = req.body as DepositInitiateRequest
        const userId = req.headers['x-user-id']
        if (typeof userId !== 'string' || userId.length === 0) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Missing x-user-id header')
        }
        const amountNgnHeader = req.headers['x-amount-ngn']
        const amountNgn = typeof amountNgnHeader === 'string' ? Number(amountNgnHeader) : NaN
        if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid NGN amount')
        }
        const originalRail = paymentRail
        const internalRail =
          originalRail === 'bank_transfer'
            ? 'bank'
            : originalRail === 'paystack' ||
              originalRail === 'flutterwave' ||
              originalRail === 'manual_admin'
            ? 'psp'
            : originalRail
        if (originalRail !== 'psp' && originalRail !== 'bank') {
          const quote = await quoteStore.getById(quoteId)
          if (!quote) {
            throw new AppError(ErrorCode.NOT_FOUND, 404, 'Quote not found')
          }
          if (quote.userId !== userId) {
            throw new AppError(ErrorCode.FORBIDDEN, 403, 'Quote does not belong to user')
          }
          const now = Date.now()
          if (quote.status !== 'active') {
            throw new AppError(ErrorCode.CONFLICT, 409, 'Quote cannot be used')
          }
          if (quote.expiresAt.getTime() <= now) {
            await quoteStore.markExpired(quote.quoteId)
            throw new AppError(ErrorCode.CONFLICT, 409, 'Quote expired')
          }
          if (quote.amountNgn !== amountNgn) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Amount mismatch with quote')
          }
          if (quote.paymentRail !== originalRail) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Payment rail mismatch with quote')
          }
          await quoteStore.markUsed(quote.quoteId)
        }
        const deposit = await depositStore.create({
          quoteId,
          userId,
          paymentRail,
          amountNgn,
          customerMeta,
        })
        let externalRefSource: string | undefined
        let externalRef: string | undefined
        let redirectUrl: string | undefined
        let bankDetails: Record<string, string> | undefined
        if (internalRail === 'psp') {
          externalRefSource = 'psp'
          externalRef = `pi_${deposit.depositId}`
          redirectUrl = `https://pay.example.com/${externalRef}`
        } else if (internalRail === 'bank') {
          externalRefSource = 'bank'
          externalRef = `bnk_${deposit.depositId}`
          bankDetails = { accountNumber: '1234567890', bankName: 'Example Bank' }
        } else {
          throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Unsupported payment rail')
        }
        await depositStore.attachExternalRef(deposit.depositId, externalRefSource, externalRef)
        logger.info('Deposit initiated', {
          depositId: deposit.depositId,
          paymentRail,
          requestId: req.requestId,
        })
        res.status(201).json({
          success: true,
          depositId: deposit.depositId,
          externalRefSource,
          externalRef,
          ...(redirectUrl ? { redirectUrl } : {}),
          ...(bankDetails ? { bankDetails } : {}),
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/staking/finalize
   *
   * Finalizes staking using the canonical USDC amount produced by a conversion.
   * - If conversion not completed -> 409
   * - Idempotent by conversionId
   */
  router.post(
    '/finalize',
    validate(stakeFinalizeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversionId } = req.body as StakeFinalizeRequest

        const conversion = await conversionStore.getByConversionId(conversionId)
        if (!conversion) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Conversion not found')
        }
        if (conversion.status !== 'completed') {
          throw new AppError(ErrorCode.CONFLICT, 409, 'Conversion not completed')
        }

        // Create outbox item idempotent by conversionId
        const outboxItem = await outboxStore.create({
          txType: TxType.STAKE,
          source: 'conversion',
          ref: conversion.conversionId,
          payload: {
            txType: TxType.STAKE,
            amountUsdc: conversion.amountUsdc,

            // Include FX metadata so receipt is deterministic.
            amountNgn: conversion.amountNgn,
            fxRateNgnPerUsdc: conversion.fxRateNgnPerUsdc,
            fxProvider: conversion.provider,

            conversionId: conversion.conversionId,
            depositId: conversion.depositId,
            conversionProviderRef: conversion.providerRef,
            userId: conversion.userId,
          },
        })

        const sent = await sender.send(outboxItem)

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
            ? 'Staking finalized and receipt written to chain'
            : 'Staking finalized, receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/staking/stake_from_deposit
   *
   * Stakes using the canonical USDC amount produced by a prior deposit conversion.
   * Idempotent by depositId (conversion is unique per deposit).
   */
  router.post(
    '/stake_from_deposit',
    validate(stakeFromDepositSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversionId } = req.body as StakeFromDepositRequest

        const conversion = await conversionStore.getByConversionId(conversionId)
        if (!conversion) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Conversion not found')
        }
        if (conversion.status !== 'completed') {
          throw new AppError(ErrorCode.CONFLICT, 409, 'Conversion not completed')
        }

        const deposit = await depositStore.getById(conversion.depositId)
        if (!deposit) {
          throw new AppError(ErrorCode.NOT_FOUND, 404, 'Deposit not found')
        }

        // Mark deposit consumed (idempotent)
        await depositStore.markConsumed(deposit.depositId)

        // Create outbox item idempotent by depositId
        const outboxItem = await outboxStore.create({
          txType: TxType.STAKE,
          source: 'deposit',
          ref: deposit.depositId,
          payload: {
            txType: TxType.STAKE,
            amountUsdc: conversion.amountUsdc,

            // Include FX metadata so the on-chain receipt can carry NGN fields deterministically.
            amountNgn: conversion.amountNgn,
            fxRateNgnPerUsdc: conversion.fxRateNgnPerUsdc,
            fxProvider: conversion.provider,

            depositId: deposit.depositId,
            conversionId: conversion.conversionId,
            conversionProviderRef: conversion.providerRef,
            userId: conversion.userId,
          },
        })

        const sent = await sender.send(outboxItem)

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
            ? 'Staking confirmed and receipt written to chain'
            : 'Staking confirmed, receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/staking/stake
   * 
   * Stake USDC tokens and record the transaction on-chain.
   * 
   * Idempotent by externalRefSource:externalRef combination.
   */
  router.post(
    '/stake',
    validate(stakeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { amountUsdc, externalRefSource, externalRef } = req.body as StakeRequest

        logger.info('Staking request received', {
          amountUsdc,
          externalRefSource,
          requestId: req.requestId,
        })

        // Create outbox item (idempotent by source+ref)
        const outboxItem = await outboxStore.create({
          txType: TxType.STAKE,
          source: externalRefSource,
          ref: externalRef,
          payload: {
            txType: TxType.STAKE,
            amountUsdc,
            externalRefSource,
            externalRef,
          },
        })

        logger.info('Outbox item created for staking', {
          outboxId: outboxItem.id,
          txId: outboxItem.txId,
          status: outboxItem.status,
          requestId: req.requestId,
        })

        // Attempt immediate on-chain write
        const sent = await sender.send(outboxItem)

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
            ? 'Staking confirmed and receipt written to chain'
            : 'Staking confirmed, receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/staking/unstake
   * 
   * Unstake USDC tokens and record the transaction on-chain.
   * 
   * Idempotent by externalRefSource:externalRef combination.
   */
  router.post(
    '/unstake',
    validate(unstakeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { amountUsdc, externalRefSource, externalRef } = req.body as UnstakeRequest

        logger.info('Unstaking request received', {
          amountUsdc,
          externalRefSource,
          requestId: req.requestId,
        })

        // Create outbox item (idempotent by source+ref)
        const outboxItem = await outboxStore.create({
          txType: TxType.UNSTAKE,
          source: externalRefSource,
          ref: externalRef,
          payload: {
            txType: TxType.UNSTAKE,
            amountUsdc,
            externalRefSource,
            externalRef,
          },
        })

        logger.info('Outbox item created for unstaking', {
          outboxId: outboxItem.id,
          txId: outboxItem.txId,
          status: outboxItem.status,
          requestId: req.requestId,
        })

        // Attempt immediate on-chain write
        const sent = await sender.send(outboxItem)

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
            ? 'Unstaking confirmed and receipt written to chain'
            : 'Unstaking confirmed, receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * POST /api/staking/claim
   * 
   * Claim staking rewards and record the transaction on-chain.
   * 
   * Idempotent by externalRefSource:externalRef combination.
   */
  router.post(
    '/claim',
    validate(claimStakeRewardSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { externalRefSource, externalRef } = req.body as ClaimStakeRewardRequest

        logger.info('Staking reward claim request received', {
          externalRefSource,
          requestId: req.requestId,
        })

        // Create outbox item (idempotent by source+ref)
        const outboxItem = await outboxStore.create({
          txType: TxType.STAKE_REWARD_CLAIM,
          source: externalRefSource,
          ref: externalRef,
          payload: {
            txType: TxType.STAKE_REWARD_CLAIM,
            externalRefSource,
            externalRef,
          },
        })

        logger.info('Outbox item created for staking reward claim', {
          outboxId: outboxItem.id,
          txId: outboxItem.txId,
          status: outboxItem.status,
          requestId: req.requestId,
        })

        // Attempt immediate on-chain write
        const sent = await sender.send(outboxItem)

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
            ? 'Staking reward claim confirmed and receipt written to chain'
            : 'Staking reward claim confirmed, receipt queued for retry',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  /**
   * GET /api/staking/position
   * 
   * Get current staking position (staked amount and claimable rewards).
   * 
   * Note: This is a mock implementation. In a real system, this would query
   * the staking contract or a database to get actual staking positions.
   */
  router.get(
    '/position',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user?.id
        if (!userId) {
          throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Authentication required')
        }

        const accountHeader = req.headers['x-wallet-address']
        let account: string
        if (typeof accountHeader === 'string' && accountHeader.length > 0) {
          account = accountHeader
        } else if (env.CUSTODIAL_MODE_ENABLED) {
          try {
            account = await walletService.getPublicAddress(userId)
          } catch (error) {
            if (error instanceof Error && error.message.includes('Wallet not found')) {
              throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'User wallet not found')
            }
            throw error
          }
        } else {
          const linked = await linkedAddressStore.getLinkedAddress(userId)
          if (!linked) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              400,
              'No linked wallet address found for user',
            )
          }
          account = linked
        }

        const [stakedMicro, claimableMicro] = await Promise.all([
          adapter.getStakedBalance(account),
          adapter.getClaimableRewards(account),
        ])

        const position: StakingPositionResponse = stakingPositionSchema.parse({
          staked: formatAmount6(stakedMicro),
          claimable: formatAmount6(claimableMicro),
        })

        logger.info('Staking position requested', {
          requestId: req.requestId,
          userId,
        })

        res.status(200).json({
          success: true,
          position,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
