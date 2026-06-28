/**
 * pricingService.test.ts
 * Golden-value tests for installment pricing math (3/6/12-month plans).
 * README reference: on a ₦840,000 balance —
 *   3mo / 8%  ≈ ₦302,400 monthly
 *   6mo / 12% ≈ ₦156,800 monthly
 *   12mo / 15% ≈ ₦80,500 monthly
 */

import { describe, expect, it } from 'vitest'
import {
  computeInstallmentSchedule,
  computeOutrightBreakdown,
  validatePricingConfig,
  PricingValidationError,
  INTEREST_TIERS,
  MIN_DEPOSIT_PERCENT,
  type InstallmentSchedule,
} from './pricingService.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sum of all monthly payments made over the term */
function totalInstallments(schedule: InstallmentSchedule): number {
  return Math.round(schedule.monthlyPayment * (schedule.totalRepayment / schedule.monthlyPayment))
}

// ── 1. Golden-value tests ─────────────────────────────────────────────────────

describe('computeInstallmentSchedule — golden values', () => {
  /**
   * README reference fixture: installment base = ₦1,000,000, 20% deposit → financed = ₦800,000
   * But README quotes are expressed as per-month figures on a ₦840k *financed* balance.
   * We back out: if financed = ₦840k, that means base price / (1 - depositPct) = ₦1,050,000 @20%
   * Simplest fixture: base = ₦1,000,000, deposit = 20% → financedBalance = ₦800,000
   *
   * 3-month / 8%:  interestAmount = 64,000; total = 864,000; monthly = 288,000
   * 6-month / 12%: interestAmount = 96,000; total = 896,000; monthly = 149,333.33
   * 12-month / 15%: interestAmount = 120,000; total = 920,000; monthly = 76,666.67
   *
   * We pin these computed values as the canonical fixtures.
   */
  const BASE_PRICE = 1_000_000
  const DEPOSIT_PCT = 0.2 // 20% → ₦200,000 deposit, ₦800,000 financed

  it('3-month plan: deposit, interest, monthly, total are correct', () => {
    const s = computeInstallmentSchedule(BASE_PRICE, DEPOSIT_PCT, 3)

    expect(s.depositAmount).toBe(200_000)
    expect(s.financedBalance).toBe(800_000)
    expect(s.interestAmount).toBe(Math.round(800_000 * INTEREST_TIERS[3]!)) // 64,000
    expect(s.totalRepayment).toBe(s.financedBalance + s.interestAmount)     // 864,000

    // Monthly = totalRepayment / 3 rounded to cents
    const expectedMonthly = Math.round((s.totalRepayment / 3) * 100) / 100
    expect(s.monthlyPayment).toBe(expectedMonthly)
  })

  it('6-month plan: deposit, interest, monthly, total are correct', () => {
    const s = computeInstallmentSchedule(BASE_PRICE, DEPOSIT_PCT, 6)

    expect(s.depositAmount).toBe(200_000)
    expect(s.financedBalance).toBe(800_000)
    expect(s.interestAmount).toBe(Math.round(800_000 * INTEREST_TIERS[6]!)) // 96,000
    expect(s.totalRepayment).toBe(s.financedBalance + s.interestAmount)     // 896,000

    const expectedMonthly = Math.round((s.totalRepayment / 6) * 100) / 100
    expect(s.monthlyPayment).toBe(expectedMonthly)
  })

  it('12-month plan: deposit, interest, monthly, total are correct', () => {
    const s = computeInstallmentSchedule(BASE_PRICE, DEPOSIT_PCT, 12)

    expect(s.depositAmount).toBe(200_000)
    expect(s.financedBalance).toBe(800_000)
    expect(s.interestAmount).toBe(Math.round(800_000 * INTEREST_TIERS[12]!)) // 120,000
    expect(s.totalRepayment).toBe(s.financedBalance + s.interestAmount)      // 920,000

    const expectedMonthly = Math.round((s.totalRepayment / 12) * 100) / 100
    expect(s.monthlyPayment).toBe(expectedMonthly)
  })

  it('README-aligned: 3mo monthly ≈ ₦302,400 when financed balance is ₦840k', () => {
    // financedBalance = 840k → base = 840k / 0.8 = 1,050,000
    const s = computeInstallmentSchedule(1_050_000, 0.2, 3)
    expect(s.financedBalance).toBe(840_000)
    // interest = 840k * 8% = 67,200; total = 907,200; monthly = 302,400
    expect(s.monthlyPayment).toBeCloseTo(302_400, 0)
  })

  it('README-aligned: 6mo monthly ≈ ₦156,800 when financed balance is ₦840k', () => {
    const s = computeInstallmentSchedule(1_050_000, 0.2, 6)
    expect(s.financedBalance).toBe(840_000)
    // interest = 840k * 12% = 100,800; total = 940,800; monthly = 156,800
    expect(s.monthlyPayment).toBeCloseTo(156_800, 0)
  })

  it('README-aligned: 12mo monthly ≈ ₦80,500 when financed balance is ₦840k', () => {
    const s = computeInstallmentSchedule(1_050_000, 0.2, 12)
    expect(s.financedBalance).toBe(840_000)
    // interest = 840k * 15% = 126,000; total = 966,000; monthly = 80,500
    expect(s.monthlyPayment).toBeCloseTo(80_500, 0)
  })
})

// ── 2. Deposit conservation ───────────────────────────────────────────────────

describe('computeInstallmentSchedule — deposit + installments reconcile to totalRepayment', () => {
  it.each([
    [0.2, 3],
    [0.25, 6],
    [0.3, 12],
    [0.4, 3],
    [0.4, 6],
    [0.4, 12],
  ])('depositPct=%f termMonths=%d: sum reconciles', (depositPct, termMonths) => {
    const s = computeInstallmentSchedule(1_000_000, depositPct, termMonths)
    // totalRepayment = financedBalance + interest (exact by construction)
    expect(s.totalRepayment).toBe(s.financedBalance + s.interestAmount)
    // Rounding: monthlyPayment * term ≈ totalRepayment within ±1 NGN per month of rounding
    const installmentSum = s.monthlyPayment * termMonths
    expect(installmentSum).toBeCloseTo(s.totalRepayment, -2)
  })
})

// ── 3. Deposit range ──────────────────────────────────────────────────────────

describe('computeInstallmentSchedule — deposit range 20–100%', () => {
  it('accepts minimum deposit of 20%', () => {
    const s = computeInstallmentSchedule(1_000_000, MIN_DEPOSIT_PERCENT, 6)
    expect(s.depositAmount).toBe(200_000)
    expect(s.financedBalance).toBe(800_000)
  })

  it('accepts maximum deposit of 100% (zero financed balance)', () => {
    const s = computeInstallmentSchedule(1_000_000, 1.0, 6)
    expect(s.depositAmount).toBe(1_000_000)
    expect(s.financedBalance).toBe(0)
    expect(s.interestAmount).toBe(0)
    expect(s.monthlyPayment).toBe(0)
  })

  it('rejects deposit below 20%', () => {
    expect(() =>
      computeInstallmentSchedule(1_000_000, 0.19, 6),
    ).toThrow()
  })

  it('rejects deposit above 100%', () => {
    expect(() =>
      computeInstallmentSchedule(1_000_000, 1.01, 6),
    ).toThrow()
  })
})

// ── 4. Invalid term ───────────────────────────────────────────────────────────

describe('computeInstallmentSchedule — invalid term', () => {
  it.each([1, 2, 4, 5, 7, 9, 11, 24])('rejects unsupported termMonths=%d', (termMonths) => {
    expect(() =>
      computeInstallmentSchedule(1_000_000, 0.2, termMonths),
    ).toThrow(/invalid term/i)
  })
})

// ── 5. Edge inputs ────────────────────────────────────────────────────────────

describe('computeInstallmentSchedule — edge inputs', () => {
  it('zero base price produces all-zero schedule', () => {
    const s = computeInstallmentSchedule(0, 0.2, 3)
    expect(s.depositAmount).toBe(0)
    expect(s.financedBalance).toBe(0)
    expect(s.interestAmount).toBe(0)
    expect(s.monthlyPayment).toBe(0)
    expect(s.totalRepayment).toBe(0)
  })
})

// ── 6. Outright breakdown ─────────────────────────────────────────────────────

describe('computeOutrightBreakdown', () => {
  it('deposit + balanceDue equals totalPayable', () => {
    const result = computeOutrightBreakdown(1_000_000, 0.3)
    expect(result.depositAmount + result.balanceDue).toBe(result.totalPayable)
    expect(result.totalPayable).toBe(1_000_000)
  })

  it('20% deposit', () => {
    const result = computeOutrightBreakdown(500_000, 0.2)
    expect(result.depositAmount).toBe(100_000)
    expect(result.balanceDue).toBe(400_000)
  })

  it('100% deposit (balance due = 0)', () => {
    const result = computeOutrightBreakdown(500_000, 1.0)
    expect(result.balanceDue).toBe(0)
  })

  it('rejects deposit below 20%', () => {
    expect(() => computeOutrightBreakdown(1_000_000, 0.1)).toThrow()
  })
})

// ── 7. Pricing config validation ──────────────────────────────────────────────

describe('validatePricingConfig', () => {
  const landlord = 800_000
  const outright = 900_000
  const installment = 1_000_000

  it('passes with valid configuration', () => {
    expect(() => validatePricingConfig(landlord, outright, installment)).not.toThrow()
  })

  it('throws PRICING_MARGIN_VIOLATION when outright <= landlord rate', () => {
    expect(() =>
      validatePricingConfig(900_000, 900_000, 1_000_000),
    ).toThrow(PricingValidationError)
  })

  it('throws PRICING_ORDER_VIOLATION when outright > installment base', () => {
    expect(() =>
      validatePricingConfig(landlord, 1_100_000, 1_000_000),
    ).toThrow(PricingValidationError)
  })

  it('throws PRICING_MARGIN_TOO_LOW when outright margin < 5%', () => {
    // outright = 804,000 → margin = 0.5% < 5%
    expect(() =>
      validatePricingConfig(800_000, 804_000, 1_000_000),
    ).toThrow(PricingValidationError)
  })

  it('accepts exactly 5% margin', () => {
    // outright = 800k * 1.05 = 840,000
    expect(() =>
      validatePricingConfig(800_000, 840_000, 1_000_000),
    ).not.toThrow()
  })
})
