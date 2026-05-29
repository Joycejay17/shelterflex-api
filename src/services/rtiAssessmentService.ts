/**
 * Rent-to-Income (RTI) Assessment Engine — issue #908.
 *
 * Assesses whether a tenant's monthly net income is sufficient to service the
 * monthly repayment for a deal. The core math lives in the pure `assessRti`
 * function; `computeRti` wires it to the tenant's verified income on record.
 *
 * Thresholds are configurable (see config/underwriting.ts):
 *   pass        rtiPercent <= passMaxPercent       (default 35%)
 *   borderline  passMax < rtiPercent <= borderline (default 35–45%)
 *   fail        rtiPercent > borderlineMaxPercent  (default > 45%)
 */

import { getRtiThresholds, type RtiThresholds } from '../config/underwriting.js'
import { tenantCreditScoreStore } from '../models/tenantCreditScoreStore.js'

export type RtiVerdict = 'pass' | 'borderline' | 'fail' | 'income_unverified'

export interface RtiAssessment {
  monthlyIncome: number | null
  monthlyRepayment: number
  /** Repayment as a percentage of income, rounded to 2dp. Null when income is unverified. */
  rtiPercent: number | null
  verdict: RtiVerdict
  assessedAt: string
}

/**
 * Pure RTI computation. Deterministic: the same inputs always produce the same
 * verdict. A non-positive or missing income yields `income_unverified` so the
 * caller can route the application to manual review rather than auto-deciding.
 */
export function assessRti(
  input: { monthlyIncome: number | null | undefined; monthlyRepayment: number },
  thresholds: RtiThresholds = getRtiThresholds(),
  now: Date = new Date(),
): RtiAssessment {
  const { monthlyRepayment } = input
  const monthlyIncome = input.monthlyIncome ?? null
  const assessedAt = now.toISOString()

  if (monthlyIncome === null || !Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
    return {
      monthlyIncome: null,
      monthlyRepayment,
      rtiPercent: null,
      verdict: 'income_unverified',
      assessedAt,
    }
  }

  const rtiPercent = Math.round((monthlyRepayment / monthlyIncome) * 100 * 100) / 100

  let verdict: RtiVerdict
  if (rtiPercent <= thresholds.passMaxPercent) {
    verdict = 'pass'
  } else if (rtiPercent <= thresholds.borderlineMaxPercent) {
    verdict = 'borderline'
  } else {
    verdict = 'fail'
  }

  return { monthlyIncome, monthlyRepayment, rtiPercent, verdict, assessedAt }
}

/** Factor-input keys under which monthly net income may be stored on the credit record. */
const INCOME_FACTOR_KEYS = ['monthlyNetIncome', 'monthlyIncome', 'netMonthlyIncome', 'income']

/**
 * Resolve a tenant's verified monthly net income from their credit score record.
 * Returns null when no credit record exists or it carries no income figure —
 * in which case the assessment is flagged `income_unverified`.
 */
export function resolveMonthlyIncome(tenantId: string): number | null {
  const record = tenantCreditScoreStore.findByTenantId(tenantId)
  if (!record) return null
  for (const key of INCOME_FACTOR_KEYS) {
    const value = record.factorInputs?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return null
}

/**
 * Assess RTI for a tenant against a deal's monthly repayment amount.
 *
 * `monthlyRepayment` is the installment plan's `monthlyPayment` (from
 * pricingService); it is passed in so this stays decoupled from the deal store.
 */
export function computeRti(
  tenantId: string,
  monthlyRepayment: number,
  thresholds: RtiThresholds = getRtiThresholds(),
): RtiAssessment {
  const monthlyIncome = resolveMonthlyIncome(tenantId)
  return assessRti({ monthlyIncome, monthlyRepayment }, thresholds)
}
