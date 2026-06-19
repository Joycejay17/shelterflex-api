/**
 * Atomic fiat <-> on-chain conversion saga.
 *
 * Models a single NGN -> USDC conversion as an explicit, durably-persisted
 * state machine (saga) so the off-chain fiat leg, the locked FX rate and the
 * on-chain (Soroban) leg never end up torn.
 *
 * Step ordering:
 *   quote_locked -> fiat_committed -> onchain_submitted -> onchain_confirmed -> completed
 *
 * Failure / compensation branch:
 *   ...           -> compensating -> compensated   (fiat refunded after a fiat
 *                                                    commit that cannot reach a
 *                                                    completed on-chain leg)
 *   quote_locked  -> failed                         (fiat never committed; safe
 *                                                    to abort, nothing to undo)
 */

export type ConversionSagaState =
  | 'quote_locked'
  | 'fiat_committed'
  | 'onchain_submitted'
  | 'onchain_confirmed'
  | 'completed'
  | 'compensating'
  | 'compensated'
  | 'failed'

/** States from which no further forward/compensation transition is allowed. */
export const TERMINAL_SAGA_STATES: ReadonlySet<ConversionSagaState> = new Set<ConversionSagaState>([
  'completed',
  'compensated',
  'failed',
])

/**
 * Allowed transitions. Every transition the orchestrator performs is validated
 * against this map so a buggy retry cannot drive the saga into an illegal state.
 */
export const SAGA_TRANSITIONS: Readonly<Record<ConversionSagaState, ReadonlyArray<ConversionSagaState>>> = {
  quote_locked: ['fiat_committed', 'failed'],
  fiat_committed: ['onchain_submitted', 'compensating'],
  onchain_submitted: ['onchain_confirmed', 'compensating'],
  onchain_confirmed: ['completed', 'compensating'],
  completed: [],
  compensating: ['compensated'],
  compensated: [],
  failed: [],
}

export function canTransition(from: ConversionSagaState, to: ConversionSagaState): boolean {
  if (from === to) return true // idempotent no-op re-entry is always allowed
  return SAGA_TRANSITIONS[from].includes(to)
}

export type ConversionSagaKind = 'deposit' | 'staking'

export type ConversionProviderName = 'onramp' | 'offramp' | 'manual_admin'

export interface ConversionSagaRecord {
  sagaId: string
  /** Synthetic deposit id used as the idempotency anchor (`stake:src:ref` for staking). */
  depositId: string
  userId: string
  kind: ConversionSagaKind
  amountNgn: number
  amountUsdc: string
  /** NGN per 1 USDC captured at quote time. The saga always executes at this rate. */
  lockedRate: number
  /** ISO timestamp after which the locked quote may no longer be executed. */
  rateExpiresAt: Date
  provider: ConversionProviderName
  /** Provider reference of the executed conversion (also the on-chain leg ref). */
  providerRef: string
  state: ConversionSagaState
  /** Reversal reference emitted by the compensation leg (refund). */
  compensationRef: string | null
  failureReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateConversionSagaInput {
  depositId: string
  userId: string
  kind: ConversionSagaKind
  amountNgn: number
  lockedRate: number
  rateExpiresAt: Date
  provider: ConversionProviderName
}
