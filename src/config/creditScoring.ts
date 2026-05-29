/**
 * Credit scoring pipeline configuration.
 * Sub-score weights must sum to 1.0; validated at startup via validateCreditScoringConfig().
 */

import { createHash } from 'node:crypto'

export const CREDIT_SCORING_VERSION = '1.0.0'

export interface CreditScoringWeights {
  income: number
  employment: number
  bankStatement: number
  alternativeData: number
}

export interface CreditBandThresholds {
  /** Minimum score for band A (inclusive). */
  a: number
  b: number
  c: number
  d: number
}

export interface CreditScoringConfig {
  version: string
  weights: CreditScoringWeights
  bandThresholds: CreditBandThresholds
}

export const DEFAULT_CREDIT_SCORING_CONFIG: CreditScoringConfig = {
  version: CREDIT_SCORING_VERSION,
  weights: {
    income: 0.35,
    employment: 0.25,
    bankStatement: 0.3,
    alternativeData: 0.1,
  },
  bandThresholds: {
    a: 800,
    b: 650,
    c: 500,
    d: 350,
  },
}

function readWeight(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getCreditScoringConfig(): CreditScoringConfig {
  const w = DEFAULT_CREDIT_SCORING_CONFIG.weights
  return {
    version: process.env.CREDIT_SCORING_VERSION ?? CREDIT_SCORING_VERSION,
    weights: {
      income: readWeight('CREDIT_WEIGHT_INCOME', w.income),
      employment: readWeight('CREDIT_WEIGHT_EMPLOYMENT', w.employment),
      bankStatement: readWeight('CREDIT_WEIGHT_BANK_STATEMENT', w.bankStatement),
      alternativeData: readWeight('CREDIT_WEIGHT_ALTERNATIVE_DATA', w.alternativeData),
    },
    bandThresholds: { ...DEFAULT_CREDIT_SCORING_CONFIG.bandThresholds },
  }
}

const WEIGHT_SUM_TOLERANCE = 1e-6

export function validateCreditScoringConfig(config: CreditScoringConfig = getCreditScoringConfig()): void {
  const { weights, bandThresholds } = config
  const sum =
    weights.income + weights.employment + weights.bankStatement + weights.alternativeData

  if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new Error(
      `Credit scoring weights must sum to 1.0, got ${sum} (income=${weights.income}, employment=${weights.employment}, bankStatement=${weights.bankStatement}, alternativeData=${weights.alternativeData})`,
    )
  }

  for (const key of ['income', 'employment', 'bankStatement', 'alternativeData'] as const) {
    const v = weights[key]
    if (v < 0 || v > 1 || !Number.isFinite(v)) {
      throw new Error(`Invalid credit scoring weight for ${key}: ${v}`)
    }
  }

  const { a, b, c, d } = bandThresholds
  if (!(a > b && b > c && c > d && d >= 0)) {
    throw new Error('Credit band thresholds must satisfy a > b > c > d >= 0')
  }
}

/** Effective weights when optional alternative data is absent (redistributed). */
export function effectiveWeights(
  weights: CreditScoringWeights,
  hasAlternativeData: boolean,
): CreditScoringWeights {
  if (hasAlternativeData) return { ...weights }

  const alt = weights.alternativeData
  const base = weights.income + weights.employment + weights.bankStatement
  if (base <= 0) {
    return { income: 1 / 3, employment: 1 / 3, bankStatement: 1 / 3, alternativeData: 0 }
  }

  return {
    income: weights.income + (alt * weights.income) / base,
    employment: weights.employment + (alt * weights.employment) / base,
    bankStatement: weights.bankStatement + (alt * weights.bankStatement) / base,
    alternativeData: 0,
  }
}

export function configVersionHash(config: CreditScoringConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
}
