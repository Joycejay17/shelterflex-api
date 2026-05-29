import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { assessRti, computeRti, resolveMonthlyIncome } from './rtiAssessmentService.js'
import { tenantCreditScoreStore } from '../models/tenantCreditScoreStore.js'

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z')

describe('assessRti', () => {
  it('passes when repayment is at or below the pass ceiling (35%)', () => {
    const exact = assessRti({ monthlyIncome: 100000, monthlyRepayment: 35000 }, undefined, FIXED_NOW)
    expect(exact.rtiPercent).toBe(35)
    expect(exact.verdict).toBe('pass')

    const under = assessRti({ monthlyIncome: 100000, monthlyRepayment: 20000 }, undefined, FIXED_NOW)
    expect(under.verdict).toBe('pass')
  })

  it('flags borderline strictly between the pass and fail ceilings (35–45%)', () => {
    const justOverPass = assessRti({ monthlyIncome: 100000, monthlyRepayment: 36000 }, undefined, FIXED_NOW)
    expect(justOverPass.rtiPercent).toBe(36)
    expect(justOverPass.verdict).toBe('borderline')

    const atBorderlineCeiling = assessRti({ monthlyIncome: 100000, monthlyRepayment: 45000 }, undefined, FIXED_NOW)
    expect(atBorderlineCeiling.rtiPercent).toBe(45)
    expect(atBorderlineCeiling.verdict).toBe('borderline')
  })

  it('fails when repayment exceeds the borderline ceiling (>45%)', () => {
    const result = assessRti({ monthlyIncome: 100000, monthlyRepayment: 46000 }, undefined, FIXED_NOW)
    expect(result.rtiPercent).toBe(46)
    expect(result.verdict).toBe('fail')
  })

  it('returns income_unverified for missing or non-positive income', () => {
    expect(assessRti({ monthlyIncome: null, monthlyRepayment: 10000 }, undefined, FIXED_NOW).verdict).toBe('income_unverified')
    expect(assessRti({ monthlyIncome: undefined, monthlyRepayment: 10000 }, undefined, FIXED_NOW).verdict).toBe('income_unverified')
    expect(assessRti({ monthlyIncome: 0, monthlyRepayment: 10000 }, undefined, FIXED_NOW).verdict).toBe('income_unverified')
    const r = assessRti({ monthlyIncome: -5, monthlyRepayment: 10000 }, undefined, FIXED_NOW)
    expect(r.rtiPercent).toBeNull()
    expect(r.monthlyIncome).toBeNull()
  })

  it('respects configurable thresholds', () => {
    const strict = assessRti(
      { monthlyIncome: 100000, monthlyRepayment: 30000 },
      { passMaxPercent: 25, borderlineMaxPercent: 35 },
      FIXED_NOW,
    )
    expect(strict.rtiPercent).toBe(30)
    expect(strict.verdict).toBe('borderline')
  })

  it('is idempotent for identical inputs', () => {
    const a = assessRti({ monthlyIncome: 250000, monthlyRepayment: 80000 }, undefined, FIXED_NOW)
    const b = assessRti({ monthlyIncome: 250000, monthlyRepayment: 80000 }, undefined, FIXED_NOW)
    expect(a).toEqual(b)
  })
})

describe('computeRti / resolveMonthlyIncome', () => {
  const tenantId = 'tenant-rti-test'

  beforeEach(() => {
    delete process.env.RTI_PASS_MAX_PERCENT
    delete process.env.RTI_BORDERLINE_MAX_PERCENT
  })

  afterEach(() => {
    delete process.env.RTI_PASS_MAX_PERCENT
    delete process.env.RTI_BORDERLINE_MAX_PERCENT
  })

  it('reads verified monthly income from the credit score record', () => {
    tenantCreditScoreStore.create({
      tenantId,
      computedScore: 700,
      riskBand: 'low',
      factorInputs: { monthlyNetIncome: 200000, paymentHistory: 90 },
      factorWeights: {},
    })

    expect(resolveMonthlyIncome(tenantId)).toBe(200000)

    const assessment = computeRti(tenantId, 50000)
    expect(assessment.rtiPercent).toBe(25)
    expect(assessment.verdict).toBe('pass')
  })

  it('flags income_unverified when the tenant has no credit record', () => {
    const assessment = computeRti('tenant-with-no-record', 50000)
    expect(assessment.verdict).toBe('income_unverified')
    expect(resolveMonthlyIncome('tenant-with-no-record')).toBeNull()
  })
})
