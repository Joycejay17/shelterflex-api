/**
 * Tests for Repayment Schedule Service
 */

import { describe, it, expect } from 'vitest'
import {
  generateSchedule,
  type RepaymentPlan,
} from './repaymentScheduleService.js'

describe('repaymentScheduleService', () => {
  describe('generateSchedule', () => {
    it('should generate correct 3-month schedule with 8% interest', () => {
      const result = generateSchedule({
        dealId: 'deal-123',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 120000, // 120,000 NGN
        depositPct: 20, // 20%
      })

      expect(result.dealId).toBe('deal-123')
      expect(result.schedule).toHaveLength(3)
      expect(result.depositAmountNgn).toBe(2400000) // 24,000 NGN in kobo
      expect(result.financedBalanceNgn).toBe(9600000) // 96,000 NGN in kobo

      // 8% annual interest for 3 months = 96,000 * 0.08 * (3/12) = 1,920 NGN
      expect(result.interestAmountNgn).toBe(192000) // 1,920 NGN in kobo
      expect(result.totalRepaymentNgn).toBe(9792000) // 97,920 NGN in kobo

      // Check monthly installments
      const monthlyInstallment = Math.floor(9792000 / 3) // 3,263,999 kobo = 32,639.99 NGN
      expect(result.schedule[0].totalAmountNgn).toBe(monthlyInstallment)
      expect(result.schedule[1].totalAmountNgn).toBe(monthlyInstallment)
      
      // Last payment absorbs rounding difference
      const lastPayment = 9792000 - (monthlyInstallment * 2)
      expect(result.schedule[2].totalAmountNgn).toBe(lastPayment)
    })

    it('should generate correct 6-month schedule with 12% interest', () => {
      const result = generateSchedule({
        dealId: 'deal-456',
        startDate: new Date('2024-01-01'),
        plan: '6m',
        installmentBasePriceNgn: 240000, // 240,000 NGN
        depositPct: 20, // 20%
      })

      expect(result.schedule).toHaveLength(6)
      expect(result.depositAmountNgn).toBe(4800000) // 48,000 NGN in kobo
      expect(result.financedBalanceNgn).toBe(19200000) // 192,000 NGN in kobo

      // 12% annual interest for 6 months = 192,000 * 0.12 * (6/12) = 11,520 NGN
      expect(result.interestAmountNgn).toBe(1152000) // 11,520 NGN in kobo
      expect(result.totalRepaymentNgn).toBe(20352000) // 203,520 NGN in kobo
    })

    it('should generate correct 12-month schedule with 15% interest', () => {
      const result = generateSchedule({
        dealId: 'deal-789',
        startDate: new Date('2024-01-01'),
        plan: '12m',
        installmentBasePriceNgn: 360000, // 360,000 NGN
        depositPct: 20, // 20%
      })

      expect(result.schedule).toHaveLength(12)
      expect(result.depositAmountNgn).toBe(7200000) // 72,000 NGN in kobo
      expect(result.financedBalanceNgn).toBe(28800000) // 288,000 NGN in kobo

      // 15% annual interest for 12 months = 288,000 * 0.15 * (12/12) = 43,200 NGN
      expect(result.interestAmountNgn).toBe(4320000) // 43,200 NGN in kobo
      expect(result.totalRepaymentNgn).toBe(33120000) // 331,200 NGN in kobo
    })

    it('should generate outright plan with no interest and 7-day due date', () => {
      const result = generateSchedule({
        dealId: 'deal-outright',
        startDate: new Date('2024-01-01'),
        plan: 'outright',
        installmentBasePriceNgn: 500000, // 500,000 NGN
        depositPct: 20, // 20%
      })

      expect(result.schedule).toHaveLength(1)
      expect(result.depositAmountNgn).toBe(10000000) // 100,000 NGN in kobo
      expect(result.financedBalanceNgn).toBe(40000000) // 400,000 NGN in kobo
      expect(result.interestAmountNgn).toBe(0) // No interest
      expect(result.totalRepaymentNgn).toBe(40000000) // 400,000 NGN in kobo

      // Check due date is 7 days from start
      const expectedDueDate = new Date('2024-01-08')
      expect(result.schedule[0].dueDate).toEqual(expectedDueDate)
    })

    it('should set due dates on same day-of-month as start date', () => {
      const result = generateSchedule({
        dealId: 'deal-dates',
        startDate: new Date('2024-01-15'), // 15th of month
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })

      expect(result.schedule[0].dueDate.getDate()).toBe(15) // Feb 15
      expect(result.schedule[1].dueDate.getDate()).toBe(15) // Mar 15
      expect(result.schedule[2].dueDate.getDate()).toBe(15) // Apr 15
    })

    it('should round last installment to absorb rounding difference', () => {
      const result = generateSchedule({
        dealId: 'deal-rounding',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 100000, // 100,000 NGN (creates rounding)
        depositPct: 20,
      })

      const sumOfPayments = result.schedule.reduce(
        (sum, item) => sum + item.totalAmountNgn,
        0
      )
      
      // Sum of all payments should equal total repayment
      expect(sumOfPayments).toBe(result.totalRepaymentNgn)
    })

    it('should store amounts in kobo (integers)', () => {
      const result = generateSchedule({
        dealId: 'deal-kobo',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 123456.78, // Decimal amount
        depositPct: 20,
      })

      // All amounts should be integers (kobo)
      result.schedule.forEach(item => {
        expect(Number.isInteger(item.principalAmountNgn)).toBe(true)
        expect(Number.isInteger(item.interestAmountNgn)).toBe(true)
        expect(Number.isInteger(item.totalAmountNgn)).toBe(true)
      })
    })

    it('should set all payment statuses to pending initially', () => {
      const result = generateSchedule({
        dealId: 'deal-status',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })

      result.schedule.forEach(item => {
        expect(item.status).toBe('pending')
      })
    })

    it('should calculate principal and interest portions proportionally', () => {
      const result = generateSchedule({
        dealId: 'deal-portions',
        startDate: new Date('2024-01-01'),
        plan: '3m',
        installmentBasePriceNgn: 120000,
        depositPct: 20,
      })

      result.schedule.forEach(item => {
        expect(item.principalAmountNgn).toBeGreaterThan(0)
        expect(item.interestAmountNgn).toBeGreaterThanOrEqual(0)
        expect(item.totalAmountNgn).toBe(
          item.principalAmountNgn + item.interestAmountNgn
        )
      })
    })
  })
})
