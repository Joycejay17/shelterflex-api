import { Router, type Request, type Response, type NextFunction } from 'express'
import { outboxStore, OutboxSender, TxType } from '../outbox/index.js'
import { SorobanAdapter } from '../soroban/adapter.js'
import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { stakeFromDepositSchema, type StakeFromDepositRequest } from '../schemas/stakeFromDeposit.js'
import { stakeFinalizeSchema, type StakeFinalizeRequest } from '../schemas/stakeFinalize.js'
import { conversionStore } from '../models/conversionStore.js'
import { depositStore } from '../models/depositStore.js'
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

export function createStakingRouter(adapter: SorobanAdapter) {
  const router = Router()
  const sender = new OutboxSender(adapter)

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
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Mock implementation - in a real system this would query the staking contract
        const mockPosition: StakingPositionResponse = {
          staked: '1000.000000',
          claimable: '50.250000',
        }

        logger.info('Staking position requested', {
          requestId: req.requestId,
        })

        res.status(200).json({
          success: true,
          position: mockPosition,
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
