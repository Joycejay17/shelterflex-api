import { describe, it, expect, afterEach } from 'vitest'
import {
  DEFAULT_CREDIT_SCORING_CONFIG,
  effectiveWeights,
  getCreditScoringConfig,
  validateCreditScoringConfig,
} from './creditScoring.js'

describe('creditScoring config', () => {
  afterEach(() => {
    delete process.env.CREDIT_WEIGHT_INCOME
    delete process.env.CREDIT_WEIGHT_EMPLOYMENT
    delete process.env.CREDIT_WEIGHT_BANK_STATEMENT
    delete process.env.CREDIT_WEIGHT_ALTERNATIVE_DATA
  })

  it('validates default weights sum to 1.0', () => {
    expect(() => validateCreditScoringConfig(DEFAULT_CREDIT_SCORING_CONFIG)).not.toThrow()
  })

  it('throws when weights do not sum to 1.0', () => {
    expect(() =>
      validateCreditScoringConfig({
        ...DEFAULT_CREDIT_SCORING_CONFIG,
        weights: { income: 0.5, employment: 0.5, bankStatement: 0.5, alternativeData: 0.5 },
      }),
    ).toThrow(/sum to 1\.0/)
  })

  it('redistributes alternative weight when optional data is absent', () => {
    const w = DEFAULT_CREDIT_SCORING_CONFIG.weights
    const effective = effectiveWeights(w, false)
    const sum = effective.income + effective.employment + effective.bankStatement + effective.alternativeData
    expect(sum).toBeCloseTo(1, 6)
    expect(effective.alternativeData).toBe(0)
  })

  it('keeps configured weights when alternative data is present', () => {
    const w = DEFAULT_CREDIT_SCORING_CONFIG.weights
    const effective = effectiveWeights(w, true)
    expect(effective).toEqual(w)
  })

  it('reads env overrides for weights', () => {
    process.env.CREDIT_WEIGHT_INCOME = '0.4'
    process.env.CREDIT_WEIGHT_EMPLOYMENT = '0.2'
    process.env.CREDIT_WEIGHT_BANK_STATEMENT = '0.3'
    process.env.CREDIT_WEIGHT_ALTERNATIVE_DATA = '0.1'
    const config = getCreditScoringConfig()
    expect(() => validateCreditScoringConfig(config)).not.toThrow()
    expect(config.weights.income).toBe(0.4)
  })
})
