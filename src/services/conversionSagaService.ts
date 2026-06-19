import { logger } from '../utils/logger.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import {
  type ConversionSagaRecord,
  type ConversionSagaState,
  type ConversionSagaKind,
  type ConversionProviderName,
  canTransition,
} from '../models/conversionSaga.js'
import { conversionSagaStore } from '../models/conversionSagaStore.js'
import { durableIdempotencyService } from './durableIdempotencyService.js'
import { type ConversionProvider } from './conversionProvider.js'
import { outboxStore, TxType, type OutboxItem } from '../outbox/index.js'
import { getUsdcTokenAddress } from '../utils/token.js'

/**
 * Off-chain fiat leg used by the saga. Production wires this to the existing
 * NgnWalletService so the COMMIT debits the NGN wallet (CONVERSION_DEBIT ledger
 * entry) and the REFUND reuses the existing reversal mechanism (TOPUP_REVERSED
 * ledger entry — the same path exercised by ngnWalletService.reversal.test.ts).
 */
export interface ConversionFiatLeg {
  /** Debit fiat for the conversion. MUST be idempotent on (refSource, ref). */
  commit(input: { userId: string; refSource: string; ref: string; amountNgn: number }): Promise<void>
  /** Refund/reverse a previously committed fiat debit. MUST be idempotent. */
  refund(input: {
    userId: string
    refSource: string
    ref: string
    amountNgn: number
    reversalRef: string
  }): Promise<void>
}

/**
 * On-chain leg used by the saga. Production enqueues a CONVERSION outbox item
 * (idempotent by source+ref) and the existing exactly-once OutboxSender drives
 * it to the chain. `submit` returns whether the chain write has confirmed; an
 * unconfirmed-but-queued submission is *recoverable* (forward recovery) and is
 * NOT treated as a torn state.
 */
export interface ConversionOnchainLeg {
  /**
   * Submit the on-chain conversion receipt.
   * @returns `{ confirmed }` — true if the chain write confirmed synchronously,
   *          false if it is durably queued for retry (forward recovery).
   * @throws if submission is unrecoverable (triggers compensation).
   */
  submit(input: {
    saga: ConversionSagaRecord
  }): Promise<{ confirmed: boolean; outboxId: string }>
}

const SAGA_SCOPE = 'conversion-saga'

/** Steps that are guarded by the durable idempotency service. */
type SagaStep = 'commit-fiat' | 'submit-onchain' | 'compensate'

/**
 * True for errors raised by the idempotency lease itself (a concurrent worker
 * holds the step, or a payload conflict) rather than by the step's side effect.
 * These must NOT poison the saga or trigger compensation — they are transient.
 */
function isIdempotencyControlError(e: unknown): boolean {
  return (
    e instanceof AppError &&
    (e.code === ErrorCode.REQUEST_IN_FLIGHT || e.code === ErrorCode.CONFLICT)
  )
}

export interface ConversionSagaConfig {
  /** How long a locked FX quote stays valid before execution is rejected. */
  rateLockTtlMs: number
  /**
   * Max fractional deviation tolerated if a re-quote is required during
   * recovery (e.g. 0.01 = 1%). Beyond this the saga refuses to execute at a
   * different price and the locked quote must be re-issued.
   */
  maxSlippage: number
}

export const DEFAULT_SAGA_CONFIG: ConversionSagaConfig = {
  rateLockTtlMs: parseInt(process.env.CONVERSION_RATE_LOCK_TTL_MS ?? String(2 * 60 * 1000), 10),
  maxSlippage: Number(process.env.CONVERSION_MAX_SLIPPAGE ?? '0.01'),
}

/**
 * Default on-chain leg: enqueue a CONVERSION outbox item and attempt an
 * immediate send via the injected sender. Idempotent by (provider, providerRef).
 */
export function createOutboxOnchainLeg(sender: {
  send: (item: OutboxItem) => Promise<boolean>
}): ConversionOnchainLeg {
  return {
    async submit({ saga }) {
      const item = await outboxStore.create({
        txType: TxType.CONVERSION,
        source: saga.provider,
        ref: saga.providerRef,
        payload: {
          txType: TxType.CONVERSION,
          amountUsdc: saga.amountUsdc,
          tokenAddress: getUsdcTokenAddress(),
          dealId: 'conversion',
          amountNgn: saga.amountNgn,
          fxRateNgnPerUsdc: saga.lockedRate,
          fxProvider: saga.provider,
          conversionId: saga.sagaId,
          depositId: saga.depositId,
          conversionProviderRef: saga.providerRef,
          userId: saga.userId,
        },
      })
      const confirmed = await sender.send(item)
      return { confirmed, outboxId: item.id }
    },
  }
}

export class ConversionSagaService {
  private readonly config: ConversionSagaConfig

  constructor(
    private readonly provider: ConversionProvider,
    private readonly fxProviderName: ConversionProviderName,
    private readonly fiatLeg: ConversionFiatLeg,
    private readonly onchainLeg: ConversionOnchainLeg,
    config: Partial<ConversionSagaConfig> = {},
  ) {
    this.config = { ...DEFAULT_SAGA_CONFIG, ...config }
  }

  /**
   * Guarded transition: validates the edge, then performs a compare-and-set on
   * the expected source state so a slow concurrent attempt cannot regress a
   * saga the winner already advanced (lost-update protection).
   */
  private async advance(
    saga: ConversionSagaRecord,
    to: ConversionSagaState,
    patch: Parameters<typeof conversionSagaStore.transition>[2] = {},
  ): Promise<ConversionSagaRecord> {
    if (!canTransition(saga.state, to)) {
      throw new AppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        409,
        `Illegal conversion saga transition ${saga.state} -> ${to}`,
        { sagaId: saga.sagaId },
      )
    }
    const updated = await conversionSagaStore.transition(saga.sagaId, to, {
      ...patch,
      expectedState: patch.expectedState ?? saga.state,
    })
    if (!updated) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Conversion saga vanished mid-transition', {
        sagaId: saga.sagaId,
      })
    }
    return updated
  }

  /**
   * Run an idempotent step. The durable idempotency service guarantees the body
   * runs at most once for a given (saga, step); concurrent duplicate retries get
   * `in_flight`, completed retries replay without re-running side effects.
   *
   * Returns the body's value on first run, or `undefined` on replay (the step's
   * side effects already happened, so callers must tolerate a replayed step).
   */
  private async runStep<T>(
    saga: ConversionSagaRecord,
    step: SagaStep,
    body: () => Promise<T>,
  ): Promise<T | undefined> {
    const idempotencyKey = `${saga.depositId}:${step}`
    const requestBodyHash = durableIdempotencyService.payloadHash({
      sagaId: saga.sagaId,
      step,
      amountNgn: saga.amountNgn,
      lockedRate: saga.lockedRate,
    })
    const start = await durableIdempotencyService.start({
      scope: SAGA_SCOPE,
      idempotencyKey,
      requestBodyHash,
    })

    if (start.type === 'replay') {
      // Step already completed in a prior attempt — no double side effect.
      return undefined
    }
    if (start.type === 'in_flight') {
      throw new AppError(ErrorCode.REQUEST_IN_FLIGHT, 409, `Conversion step ${step} already in flight`, {
        sagaId: saga.sagaId,
      })
    }
    if (start.type === 'conflict') {
      throw new AppError(ErrorCode.CONFLICT, 409, `Conversion step ${step} payload conflict`, {
        sagaId: saga.sagaId,
      })
    }

    try {
      const value = await body()
      await durableIdempotencyService.complete({
        scope: SAGA_SCOPE,
        idempotencyKey,
        httpStatus: 200,
        body: { step, sagaId: saga.sagaId },
      })
      return value
    } catch (e) {
      // Release the lease so a retry can re-run this step.
      await durableIdempotencyService.fail({
        scope: SAGA_SCOPE,
        idempotencyKey,
        message: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  /** Reject execution of a saga whose locked quote has expired. */
  private assertNotExpired(saga: ConversionSagaRecord): void {
    if (Date.now() > saga.rateExpiresAt.getTime()) {
      throw new AppError(
        ErrorCode.CONFLICT,
        409,
        `Locked FX quote expired at ${saga.rateExpiresAt.toISOString()}; re-quote required`,
        { sagaId: saga.sagaId, code: 'RATE_EXPIRED' },
      )
    }
  }

  /**
   * Quote-lock step: capture the current rate with an expiry and persist it WITH
   * the saga record. Idempotent per deposit — an existing saga keeps its
   * original locked rate (recovery uses the original price, never a fresh quote).
   */
  async lockQuote(input: {
    depositId: string
    userId: string
    kind: ConversionSagaKind
    amountNgn: number
  }): Promise<ConversionSagaRecord> {
    const existing = await conversionSagaStore.getByDepositId(input.depositId)
    if (existing) return existing

    if (input.amountNgn <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'amountNgn must be positive')
    }

    const quote = await this.provider.getRate()
    if (!Number.isFinite(quote.rate) || quote.rate <= 0) {
      throw new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, 502, 'Conversion provider returned an invalid rate')
    }

    return conversionSagaStore.createQuoteLocked({
      depositId: input.depositId,
      userId: input.userId,
      kind: input.kind,
      amountNgn: input.amountNgn,
      lockedRate: quote.rate,
      rateExpiresAt: new Date(Date.now() + this.config.rateLockTtlMs),
      provider: this.fxProviderName,
    })
  }

  /**
   * Drive a quote-locked saga to completion (or compensation).
   *
   * Ordering guarantees the acceptance criteria:
   *   1. If fiat commit fails -> the chain leg never starts (saga -> failed).
   *   2. After fiat commit, if the chain leg is unrecoverable -> deterministic
   *      refund via the existing reversal mechanism (saga -> compensated).
   *   3. A queued-but-unconfirmed chain leg is forward recovery, NOT torn.
   */
  async execute(saga: ConversionSagaRecord): Promise<ConversionSagaRecord> {
    let current = saga

    // Already terminal — replay-safe no-op.
    if (current.state === 'completed' || current.state === 'compensated' || current.state === 'failed') {
      return current
    }

    this.assertNotExpired(current)

    // --- Step 0: execute the FX conversion at the LOCKED rate -----------------
    // Compute the USDC amount from the locked rate (never a fresh quote). We
    // still call the provider to obtain a providerRef, but reject if the
    // returned rate has drifted beyond the slippage policy.
    if (current.state === 'quote_locked' && current.providerRef === '') {
      const result = await this.provider.convertNgnToUsdc({
        amountNgn: current.amountNgn,
        userId: current.userId,
        depositId: current.depositId,
      })
      this.assertSlippageWithinPolicy(current.lockedRate, result.fxRateNgnPerUsdc, current.sagaId)
      // Compare-and-set: only stamp the providerRef/usdc while still
      // quote_locked. A concurrent attempt that has already advanced the saga
      // wins (CAS miss returns the advanced record, never regressing it).
      current =
        (await conversionSagaStore.transition(current.sagaId, 'quote_locked', {
          amountUsdc: this.usdcAtLockedRate(current.amountNgn, current.lockedRate),
          providerRef: result.providerRef,
          expectedState: 'quote_locked',
        })) ?? current
    }

    // --- Step 1: commit the fiat leg -----------------------------------------
    if (current.state === 'quote_locked') {
      try {
        await this.runStep(current, 'commit-fiat', () =>
          this.fiatLeg.commit({
            userId: current.userId,
            refSource: current.provider,
            ref: current.providerRef,
            amountNgn: current.amountNgn,
          }),
        )
      } catch (e) {
        // A transient idempotency-control bounce (another worker holds the
        // lease, or a conflicting in-flight key) is NOT a fiat failure: leave
        // the saga in quote_locked so a later attempt can finish it. Only a
        // genuine fiat-commit failure aborts the saga (nothing to undo).
        if (isIdempotencyControlError(e)) throw e
        const msg = e instanceof Error ? e.message : String(e)
        logger.error('Conversion saga: fiat commit failed; aborting before chain leg', {
          sagaId: current.sagaId,
          error: msg,
        })
        await this.advance(current, 'failed', { failureReason: `fiat_commit_failed: ${msg}` })
        throw e
      }
      current = await this.advance(current, 'fiat_committed')
    }

    // --- Step 2: submit the on-chain leg -------------------------------------
    if (current.state === 'fiat_committed') {
      let submission: { confirmed: boolean; outboxId: string } | undefined
      try {
        submission = await this.runStep(current, 'submit-onchain', () =>
          this.onchainLeg.submit({ saga: current }),
        )
      } catch (e) {
        // A transient idempotency-control bounce means another worker is
        // already submitting — re-throw without compensating (fiat stays
        // committed; forward recovery will complete it).
        if (isIdempotencyControlError(e)) throw e
        // Chain leg unrecoverable AFTER fiat commit -> compensate (refund).
        const msg = e instanceof Error ? e.message : String(e)
        logger.error('Conversion saga: on-chain leg unrecoverable; compensating', {
          sagaId: current.sagaId,
          error: msg,
        })
        return this.compensate(current, msg)
      }

      current = await this.advance(current, 'onchain_submitted')

      // A confirmed synchronous submission completes the saga; an unconfirmed
      // (queued) submission is left for forward recovery by the outbox worker.
      if (submission?.confirmed) {
        current = await this.advance(current, 'onchain_confirmed')
        current = await this.advance(current, 'completed')
      }
    }

    return current
  }

  /**
   * Compensating action: refund the fiat debit using the EXISTING reversal
   * mechanism, then mark the saga compensated. Idempotent — a retried
   * compensation does not double-refund.
   */
  async compensate(saga: ConversionSagaRecord, reason: string): Promise<ConversionSagaRecord> {
    if (saga.state === 'compensated') return saga
    if (saga.state === 'completed') {
      throw new AppError(ErrorCode.INVALID_STATE_TRANSITION, 409, 'Cannot compensate a completed saga', {
        sagaId: saga.sagaId,
      })
    }

    let current = saga.state === 'compensating' ? saga : await this.advance(saga, 'compensating', {
      failureReason: reason,
    })

    const reversalRef = `conv-refund:${current.sagaId}`
    await this.runStep(current, 'compensate', () =>
      this.fiatLeg.refund({
        userId: current.userId,
        refSource: current.provider,
        ref: current.providerRef,
        amountNgn: current.amountNgn,
        reversalRef,
      }),
    )

    current = await this.advance(current, 'compensated', { compensationRef: reversalRef })
    logger.info('Conversion saga compensated (fiat refunded)', {
      sagaId: current.sagaId,
      reason,
      reversalRef,
    })
    return current
  }

  /**
   * Convenience entry point: lock the quote then execute end-to-end.
   * Idempotent by deposit id — repeated calls converge on the same saga.
   */
  async convert(input: {
    depositId: string
    userId: string
    kind: ConversionSagaKind
    amountNgn: number
  }): Promise<ConversionSagaRecord> {
    const saga = await this.lockQuote(input)
    return this.execute(saga)
  }

  private usdcAtLockedRate(amountNgn: number, lockedRate: number): string {
    return (amountNgn / lockedRate).toFixed(6)
  }

  private assertSlippageWithinPolicy(lockedRate: number, executedRate: number, sagaId: string): void {
    if (!Number.isFinite(executedRate) || executedRate <= 0) return
    const slippage = Math.abs(executedRate - lockedRate) / lockedRate
    if (slippage > this.config.maxSlippage) {
      throw new AppError(
        ErrorCode.CONFLICT,
        409,
        `FX slippage ${(slippage * 100).toFixed(2)}% exceeds max ${(this.config.maxSlippage * 100).toFixed(2)}%; re-quote required`,
        { sagaId, lockedRate, executedRate, code: 'SLIPPAGE_EXCEEDED' },
      )
    }
  }
}

/**
 * Production fiat leg backed by NgnWalletService.
 *
 * COMMIT  -> debitNgnForConversion (CONVERSION_DEBIT ledger entry)
 * REFUND  -> reverseTopUp          (TOPUP_REVERSED ledger entry — the existing
 *                                   reversal mechanism)
 */
export function createNgnWalletFiatLeg(ngnWalletService: {
  debitNgnForConversion: (
    userId: string,
    externalRefSource: string,
    externalRef: string,
    amountNgn: number,
  ) => Promise<unknown>
  reverseTopUp: (
    userId: string,
    depositId: string,
    amountNgn: number,
    reference: string,
  ) => Promise<unknown>
}): ConversionFiatLeg {
  return {
    async commit({ userId, refSource, ref, amountNgn }) {
      await ngnWalletService.debitNgnForConversion(userId, refSource, ref, amountNgn)
    },
    async refund({ userId, ref, amountNgn, reversalRef }) {
      await ngnWalletService.reverseTopUp(userId, ref, amountNgn, reversalRef)
    },
  }
}
