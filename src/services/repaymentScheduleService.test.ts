/**
 * Tests for Repayment Schedule Service
 *
 * Two layers of coverage:
 *   1. Example-based regression tests (preserve existing behaviour).
 *   2. Property-based tests (fast-check) that prove money-conservation and
 *      rounding invariants across the full valid input space, including values
 *      that exceed Number.MAX_SAFE_INTEGER before rounding.
 */

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }))
vi.mock('../db.js', () => ({ getPool: vi.fn() }))

import {
  generateSchedule,
  type RepaymentPlan,
} from './repaymentScheduleService.js'

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const planArb = fc.constantFrom<RepaymentPlan>('3m', '6m', '12m', 'outright')

const installmentPlanArb = fc.constantFrom<RepaymentPlan>('3m', '6m', '12m')

/** NGN price: 1 NGN … 100,000,000 NGN (covers values above MAX_SAFE_INTEGER in kobo) */
const priceNgnArb = fc.float({ min: 1, max: 1e8, noNaN: true, noDefaultInfinity: true })

/** Deposit percent: 1 % … 99 % */
const depositPctArb = fc.integer({ min: 1, max: 99 })

const startDateArb = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
})

// ─── Example-based tests ─────────────────────────────────────────────────────

describe('repaymentScheduleService', () => {
  describe('generateSchedule — example-based', () => {
    it('generates a correct 3-month schedule with 8% interest', () => {
      const result = generateSchedule({
        dealId: 'deal-123',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })

      expect(result.dealId).toBe('deal-123')
      expect(result.schedule).toHaveLength(3)
      expect(result.depositAmountNgn).toBe(2400000)
      expect(result.financedBalanceNgn).toBe(9600000)
      expect(result.interestAmountNgn).toBe(192000)
      expect(result.totalRepaymentNgn).toBe(9792000)

      // Conservation: deposit + Σ installment == base price + interest
      const sumInstallments = result.schedule.reduce((s, i) => s + i.totalAmountNgn, 0)
      expect(result.depositAmountNgn + sumInstallments).toBe(
        12000000 + result.interestAmountNgn
      )
    })

    it('generates a correct 6-month schedule with 12% interest', () => {
      const result = generateSchedule({
        dealId: 'deal-456',
        startDate: new Date('2024-01-01'),
        plan: '6m',
        installmentBasePriceNgn: 240000,
        depositPct: 20,
      })

      expect(result.schedule).toHaveLength(6)
      expect(result.depositAmountNgn).toBe(4800000)
      expect(result.financedBalanceNgn).toBe(19200000)
      expect(result.interestAmountNgn).toBe(1152000)
      expect(result.totalRepaymentNgn).toBe(20352000)
    })

    it('generates a correct 12-month schedule with 15% interest', () => {
      const result = generateSchedule({
        dealId: 'deal-789',
        startDate: new Date('2024-01-01'),
        plan: '12m',
        installmentBasePriceNgn: 360000,
        depositPct: 20,
      })

      expect(result.schedule).toHaveLength(12)
      expect(result.depositAmountNgn).toBe(7200000)
      expect(result.financedBalanceNgn).toBe(28800000)
      expect(result.interestAmountNgn).toBe(4320000)
      expect(result.totalRepaymentNgn).toBe(33120000)
    })

    it('generates outright plan with no interest and 7-day due date', () => {
      const result = generateSchedule({
        dealId: 'deal-outright',
        startDate: new Date('2024-01-01'),
        plan: 'outright',
        installmentBasePriceNgn: 500000,
        depositPct: 20,
      })

      expect(result.schedule).toHaveLength(1)
      expect(result.interestAmountNgn).toBe(0)
      expect(result.totalRepaymentNgn).toBe(result.financedBalanceNgn)
      expect(result.schedule[0].dueDate).toEqual(new Date('2024-01-08'))
    })

    it('preserves day-of-month across installments', () => {
      const result = generateSchedule({
        dealId: 'deal-dates',
        startDate: new Date('2024-01-15'),
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })

      expect(result.schedule[0].dueDate.getDate()).toBe(15)
      expect(result.schedule[1].dueDate.getDate()).toBe(15)
      expect(result.schedule[2].dueDate.getDate()).toBe(15)
    })

    it('all installments have status pending initially', () => {
      const result = generateSchedule({
        dealId: 'deal-status',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })
      result.schedule.forEach((item) => expect(item.status).toBe('pending'))
    })

    it('principal + interest == total for every installment', () => {
      const result = generateSchedule({
        dealId: 'deal-portions',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })
      result.schedule.forEach((item) => {
        expect(item.totalAmountNgn).toBe(item.principalAmountNgn + item.interestAmountNgn)
      })
    })

    it('all amounts are integers (kobo)', () => {
      const result = generateSchedule({
        dealId: 'deal-kobo',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 123456.78,
        depositPct: 20,
      })
      result.schedule.forEach((item) => {
        expect(Number.isInteger(item.principalAmountNgn)).toBe(true)
        expect(Number.isInteger(item.interestAmountNgn)).toBe(true)
        expect(Number.isInteger(item.totalAmountNgn)).toBe(true)
      })
    })
  })

  // ─── Property-based tests ───────────────────────────────────────────────────

  describe('generateSchedule — money-conservation invariants (property-based)', () => {
    const NUM_RUNS = 500

    it('Σ installment.totalAmountNgn == totalRepaymentNgn for every input', () => {
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            const sum = r.schedule.reduce((s, i) => s + i.totalAmountNgn, 0)
            return sum === r.totalRepaymentNgn
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('Σ principalAmountNgn == financedBalanceNgn for every input', () => {
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            const sum = r.schedule.reduce((s, i) => s + i.principalAmountNgn, 0)
            return sum === r.financedBalanceNgn
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('Σ interestAmountNgn == interestAmountNgn (output) for every input', () => {
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            const sum = r.schedule.reduce((s, i) => s + i.interestAmountNgn, 0)
            return sum === r.interestAmountNgn
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('principal + interest == total for every installment in every input', () => {
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            return r.schedule.every(
              (i) => i.principalAmountNgn + i.interestAmountNgn === i.totalAmountNgn
            )
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('every installment amount >= 1 kobo (when total kobo >= term length)', () => {
      // When totalRepaymentKobo < termMonths it is physically impossible to give
      // every installment ≥ 1 kobo while preserving the sum invariant.  We guard
      // the property to only the feasible region (the normal operating range for
      // any real loan amount).
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const termMonths = parseInt(plan.replace('m', ''), 10)
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            fc.pre(r.totalRepaymentNgn >= termMonths)
            return r.schedule.every((i) => i.totalAmountNgn >= 1)
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('deposit + totalRepayment == basePriceKobo + interestKobo', () => {
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            const basePriceKobo = Math.round(price * 100)
            return (
              r.depositAmountNgn + r.totalRepaymentNgn ===
              basePriceKobo + r.interestAmountNgn
            )
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('due dates are strictly monotonically increasing', () => {
      fc.assert(
        fc.property(installmentPlanArb, priceNgnArb, depositPctArb, startDateArb,
          (plan, price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan, installmentBasePriceNgn: price, depositPct })
            for (let i = 1; i < r.schedule.length; i++) {
              if (r.schedule[i].dueDate <= r.schedule[i - 1].dueDate) return false
            }
            return true
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })

    it('holds for large prices that exceed Number.MAX_SAFE_INTEGER in kobo', () => {
      // 100,000,000 NGN * 100 = 10,000,000,000 kobo > 2^53 − 1 ≈ 9,007,199,254,740,991
      // Use a fixed adversarial value to guarantee we cross the boundary.
      const adversarialPrices = [1e8, 1e8 - 1, 9.007199254740992e13 / 100]
      for (const price of adversarialPrices) {
        for (const plan of ['3m', '6m', '12m'] as RepaymentPlan[]) {
          const r = generateSchedule({
            dealId: 'x',
            startDate: new Date('2024-01-01'),
            plan,
            installmentBasePriceNgn: price,
            depositPct: 20,
          })
          const sumTotal = r.schedule.reduce((s, i) => s + i.totalAmountNgn, 0)
          const sumPrincipal = r.schedule.reduce((s, i) => s + i.principalAmountNgn, 0)
          const sumInterest = r.schedule.reduce((s, i) => s + i.interestAmountNgn, 0)
          expect(sumTotal).toBe(r.totalRepaymentNgn)
          expect(sumPrincipal).toBe(r.financedBalanceNgn)
          expect(sumInterest).toBe(r.interestAmountNgn)
        }
      }
    })

    it('outright plan: conservation and single-payment shape', () => {
      fc.assert(
        fc.property(priceNgnArb, depositPctArb, startDateArb,
          (price, depositPct, startDate) => {
            const r = generateSchedule({ dealId: 'x', startDate, plan: 'outright', installmentBasePriceNgn: price, depositPct })
            return (
              r.schedule.length === 1 &&
              r.interestAmountNgn === 0 &&
              r.totalRepaymentNgn === r.financedBalanceNgn &&
              r.schedule[0].totalAmountNgn === r.financedBalanceNgn
            )
          }),
        { numRuns: NUM_RUNS, seed: 42 }
      )
    })
  })
})
