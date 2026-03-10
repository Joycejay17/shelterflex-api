import { logger } from '../utils/logger.js'
import { conversionStore } from '../models/conversionStore.js'
import { type ConversionRecord } from '../models/conversion.js'
import { type ConversionProvider } from './conversionProvider.js'
import { outboxStore, TxType } from '../outbox/index.js'
import { getUsdcTokenAddress } from '../utils/token.js'

export class ConversionService {
  constructor(
    private provider: ConversionProvider,
    private fxProviderName: 'onramp' | 'offramp' | 'manual_admin',
  ) {}

  private async ensureConversionReceiptOutbox(conversion: ConversionRecord): Promise<void> {
    if (!conversion.providerRef) return

    await outboxStore.create({
      txType: TxType.CONVERSION,
      source: this.fxProviderName,
      ref: conversion.providerRef,
      payload: {
        txType: TxType.CONVERSION,
        amountUsdc: conversion.amountUsdc,
        tokenAddress: getUsdcTokenAddress(),
        dealId: 'conversion',
        amountNgn: conversion.amountNgn,
        fxRateNgnPerUsdc: conversion.fxRateNgnPerUsdc,
        fxProvider: conversion.provider,
        conversionId: conversion.conversionId,
        depositId: conversion.depositId,
        conversionProviderRef: conversion.providerRef,
        userId: conversion.userId,
      },
    })
  }

  /**
   * Execute conversion once per deposit.
   * Idempotent: if already completed, returns existing completed conversion.
   */
  async convertDeposit(params: {
    depositId: string
    userId: string
    amountNgn: number
  }): Promise<ConversionRecord> {
    const existing = await conversionStore.getByDepositId(params.depositId)
    if (existing?.status === 'completed') {
      await this.ensureConversionReceiptOutbox(existing)
      return existing
    }

    const pending = await conversionStore.createPending({
      depositId: params.depositId,
      userId: params.userId,
      amountNgn: params.amountNgn,
      provider: this.fxProviderName,
    })

    if (pending.status === 'completed') {
      await this.ensureConversionReceiptOutbox(pending)
      return pending
    }

    try {
      const result = await this.provider.convertNgnToUsdc({
        amountNgn: params.amountNgn,
        userId: params.userId,
        depositId: params.depositId,
      })

      const completed = await conversionStore.markCompleted(pending.conversionId, {
        amountUsdc: result.amountUsdc,
        fxRateNgnPerUsdc: result.fxRateNgnPerUsdc,
        providerRef: result.providerRef,
      })

      if (!completed) {
        throw new Error('Failed to mark conversion completed')
      }

      await this.ensureConversionReceiptOutbox(completed)

      return completed
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('Conversion failed', {
        depositId: params.depositId,
        error: msg,
      })
      await conversionStore.markFailed(pending.conversionId, msg)
      throw e
    }
  }

  /**
   * Execute conversion for staking operation.
   * Uses synthetic depositId format: stake:{externalRefSource}:{externalRef}
   * Idempotent: if already completed, returns existing completed conversion.
   */
  async convertForStaking(params: {
    externalRefSource: string
    externalRef: string
    userId: string
    amountNgn: number
  }): Promise<ConversionRecord> {
    // Use synthetic depositId for staking conversions
    const syntheticDepositId = `stake:${params.externalRefSource}:${params.externalRef}`
    
    const existing = await conversionStore.getByDepositId(syntheticDepositId)
    if (existing?.status === 'completed') {
      await this.ensureConversionReceiptOutbox(existing)
      return existing
    }

    const pending = await conversionStore.createPending({
      depositId: syntheticDepositId,
      userId: params.userId,
      amountNgn: params.amountNgn,
      provider: this.fxProviderName,
    })

    if (pending.status === 'completed') {
      await this.ensureConversionReceiptOutbox(pending)
      return pending
    }

    try {
      const result = await this.provider.convertNgnToUsdc({
        amountNgn: params.amountNgn,
        userId: params.userId,
        depositId: syntheticDepositId,
      })

      const completed = await conversionStore.markCompleted(pending.conversionId, {
        amountUsdc: result.amountUsdc,
        fxRateNgnPerUsdc: result.fxRateNgnPerUsdc,
        providerRef: result.providerRef,
      })

      if (!completed) {
        throw new Error('Failed to mark conversion completed')
      }

      await this.ensureConversionReceiptOutbox(completed)

      return completed
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('Staking conversion failed', {
        syntheticDepositId,
        externalRefSource: params.externalRefSource,
        externalRef: params.externalRef,
        error: msg,
      })
      await conversionStore.markFailed(pending.conversionId, msg)
      throw e
    }
  }
}
