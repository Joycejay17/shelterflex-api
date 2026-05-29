/**
 * Landlord Payout Computation Service — issue #907.
 *
 * Computes the payout schedule owed to a landlord for a deal:
 *   - An upfront payout: a configurable share of the deposit (default 80%),
 *     with the platform retaining the remainder as its service fee.
 *   - One instalment payout per tenant instalment: the landlord's share of the
 *     instalment gross, minus the platform fee margin.
 *
 * The computation here is pure and deterministic so it is straightforward to
 * test and to replay idempotently. Persisting the result (via
 * landlordPayoutScheduleStore) and triggering disbursement are the caller's
 * responsibility.
 */

import type { Deduction } from '../schemas/landlordPayoutSchedule.js'

export interface LandlordPayoutConfig {
  /** Fraction of the deposit paid to the landlord upfront (0..1). */
  upfrontDepositShare: number
  /** Platform fee fraction applied to each instalment gross (0..1). */
  instalmentPlatformFeeShare: number
}

export const DEFAULT_LANDLORD_PAYOUT_CONFIG: LandlordPayoutConfig = {
  upfrontDepositShare: 0.8,
  instalmentPlatformFeeShare: 0.2,
}

function readShare(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback
  return parsed
}

/**
 * Resolve the active payout config, allowing environment overrides:
 *   LANDLORD_UPFRONT_DEPOSIT_SHARE      (default 0.8)
 *   LANDLORD_INSTALMENT_PLATFORM_FEE    (default 0.2)
 */
export function getLandlordPayoutConfig(): LandlordPayoutConfig {
  return {
    upfrontDepositShare: readShare(
      'LANDLORD_UPFRONT_DEPOSIT_SHARE',
      DEFAULT_LANDLORD_PAYOUT_CONFIG.upfrontDepositShare,
    ),
    instalmentPlatformFeeShare: readShare(
      'LANDLORD_INSTALMENT_PLATFORM_FEE',
      DEFAULT_LANDLORD_PAYOUT_CONFIG.instalmentPlatformFeeShare,
    ),
  }
}

export type PayoutLineKind = 'upfront' | 'instalment'

export interface PayoutScheduleLine {
  kind: PayoutLineKind
  /** 1-based instalment index; undefined for the upfront line. */
  instalmentNumber?: number
  grossAmount: number
  platformFee: number
  netAmount: number
}

export interface ComputedPayoutSchedule {
  dealId: string
  landlordId: string
  currency: 'NGN'
  lines: PayoutScheduleLine[]
  totals: {
    gross: number
    platformFee: number
    net: number
  }
}

export interface ComputePayoutScheduleInput {
  dealId: string
  landlordId: string
  /** Total deposit amount in NGN. */
  depositNgn: number
  /** Gross amount (NGN) of each tenant instalment, in order. */
  instalmentAmountsNgn: number[]
}

function roundNgn(value: number): number {
  return Math.round(value)
}

/**
 * Split a financed amount into `termMonths` instalments. Even split with any
 * rounding remainder folded into the final instalment so the parts sum exactly.
 */
export function deriveInstalmentAmounts(financedAmountNgn: number, termMonths: number): number[] {
  if (!Number.isFinite(financedAmountNgn) || financedAmountNgn < 0) {
    throw new Error('financedAmountNgn must be a non-negative number')
  }
  if (!Number.isInteger(termMonths) || termMonths <= 0) {
    throw new Error('termMonths must be a positive integer')
  }
  const base = Math.floor(financedAmountNgn / termMonths)
  const amounts = new Array(termMonths).fill(base)
  const remainder = financedAmountNgn - base * termMonths
  amounts[termMonths - 1] += remainder
  return amounts
}

/**
 * Pure payout schedule computation. Deterministic: identical input yields an
 * identical schedule (re-runnable / idempotent at the computation layer).
 */
export function computePayoutScheduleFromInput(
  input: ComputePayoutScheduleInput,
  config: LandlordPayoutConfig = getLandlordPayoutConfig(),
): ComputedPayoutSchedule {
  const { dealId, landlordId, depositNgn, instalmentAmountsNgn } = input

  if (!Number.isFinite(depositNgn) || depositNgn < 0) {
    throw new Error('depositNgn must be a non-negative number')
  }

  const lines: PayoutScheduleLine[] = []

  // Upfront payout from the deposit.
  const upfrontNet = roundNgn(depositNgn * config.upfrontDepositShare)
  lines.push({
    kind: 'upfront',
    grossAmount: depositNgn,
    platformFee: depositNgn - upfrontNet,
    netAmount: upfrontNet,
  })

  // One payout per instalment, net of the platform fee margin.
  instalmentAmountsNgn.forEach((gross, idx) => {
    if (!Number.isFinite(gross) || gross < 0) {
      throw new Error(`instalment ${idx + 1} amount must be a non-negative number`)
    }
    const platformFee = roundNgn(gross * config.instalmentPlatformFeeShare)
    lines.push({
      kind: 'instalment',
      instalmentNumber: idx + 1,
      grossAmount: gross,
      platformFee,
      netAmount: gross - platformFee,
    })
  })

  const totals = lines.reduce(
    (acc, l) => ({
      gross: acc.gross + l.grossAmount,
      platformFee: acc.platformFee + l.platformFee,
      net: acc.net + l.netAmount,
    }),
    { gross: 0, platformFee: 0, net: 0 },
  )

  return { dealId, landlordId, currency: 'NGN', lines, totals }
}

/**
 * Map a computed payout line to the `deductions` shape used by
 * landlordPayoutScheduleStore, so the schedule can be persisted consistently.
 */
export function toDeductions(line: PayoutScheduleLine): Deduction[] {
  if (line.platformFee <= 0) return []
  return [{ type: 'platform_fee', label: 'Platform Fee', amount: line.platformFee }]
}
