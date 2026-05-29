/**
 * Tenant credit score model — composite pipeline output (0–1000, bands A–F).
 */

export type CreditBand = 'A' | 'B' | 'C' | 'D' | 'F'

export interface TenantCreditScore {
  id: string
  tenantId: string
  /** Composite score on a 0–1000 scale. */
  score: number
  band: CreditBand
  incomeScore: number
  employmentScore: number
  bankStatementScore: number
  /** Null when alternative data was not supplied. */
  alternativeDataScore: number | null
  computedAt: Date
  /** Scoring algorithm / config version for idempotency. */
  version: string
  /** Hash of tenant verification data used for this computation. */
  dataVersion: string
}

export type UnderwritingDecisionFromBand = 'approve' | 'manual_review' | 'reject'

/** Map credit band to underwriting-style decision (issue spec). */
export function decisionFromCreditBand(band: CreditBand): UnderwritingDecisionFromBand {
  if (band === 'A' || band === 'B') return 'approve'
  if (band === 'C') return 'manual_review'
  return 'reject'
}

/** Resolve letter band from a 0–1000 composite score. */
export function bandFromCompositeScore(
  score: number,
  thresholds: { a: number; b: number; c: number; d: number },
): CreditBand {
  if (score >= thresholds.a) return 'A'
  if (score >= thresholds.b) return 'B'
  if (score >= thresholds.c) return 'C'
  if (score >= thresholds.d) return 'D'
  return 'F'
}
