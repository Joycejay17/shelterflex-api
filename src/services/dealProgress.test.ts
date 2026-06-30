import { describe, expect, it } from 'vitest'
import { computeDealProgress } from './dealProgress.js'
import { OutboxStatus, TxType } from '../outbox/types.js'
import type { DealWithSchedule } from '../models/deal.js'
import type { OutboxItem } from '../outbox/types.js'

function makeSchedule(termMonths: number, startMonth = '2024-01') {
  return Array.from({ length: termMonths }, (_, i) => {
    const month = ((parseInt(startMonth.split('-')[1]) + i - 1) % 12) + 1
    const year = parseInt(startMonth.split('-')[0]) + Math.floor((parseInt(startMonth.split('-')[1]) - 1 + i) / 12)
    return {
      period: i + 1,
      dueDate: `${year}-${String(month).padStart(2, '0')}-15`,
      amountNgn: 100000,
      status: 'upcoming' as const,
    }
  })
}

function makeDeal(overrides: Partial<DealWithSchedule> = {}): DealWithSchedule {
  const termMonths = overrides.termMonths ?? 12
  return {
    dealId: 'deal-1',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    annualRentNgn: 1200000,
    depositNgn: 120000,
    financedAmountNgn: 1200000,
    termMonths,
    createdAt: new Date('2024-01-01'),
    status: 'active',
    repaymentMethod: 'salary_deduction',
    schedule: overrides.schedule ?? makeSchedule(termMonths),
    ...overrides,
  }
}

function makeReceipt(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: `outbox-${Math.random().toString(36).slice(2)}`,
    txType: TxType.TENANT_REPAYMENT,
    canonicalExternalRefV1: 'v1|source=paystack|ref=pi_test123',
    txId: `tx-${Math.random().toString(36).slice(2)}`,
    payload: { amountUsdc: '50.000000' },
    status: OutboxStatus.SENT,
    attempts: 1,
    aggregateType: 'deal',
    aggregateId: 'deal-1',
    eventType: 'tenant_repayment',
    retryCount: 0,
    nextRetryAt: null,
    processedAt: new Date(),
    confirmationDepth: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('computeDealProgress', () => {
  describe('zero installments paid', () => {
    it('returns 0 paid, full remaining, and first due date', () => {
      const deal = makeDeal({ termMonths: 12 })
      const progress = computeDealProgress(deal, [])

      expect(progress.periodsPaid).toBe(0)
      expect(progress.remainingPeriods).toBe(12)
      expect(progress.totalPaidUsdc).toBe('0.000000')
      expect(progress.nextDueDate).toBe('2024-01-15')
      expect(progress.lastPaymentTxId).toBeUndefined()
    })
  })

  describe('mid-deal progress', () => {
    it('computes correct counts and next due date for 4 of 12 paid', () => {
      const deal = makeDeal({ termMonths: 12 })
      const receipts = [
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
      ]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.periodsPaid).toBe(4)
      expect(progress.remainingPeriods).toBe(8)
      expect(progress.totalPaidUsdc).toBe('200.000000')
      expect(progress.nextDueDate).toBe('2024-05-15')
      expect(progress.lastPaymentTxId).toBeDefined()
    })
  })

  describe('fully paid deal', () => {
    it('returns all paid, 0 remaining, and null next due date', () => {
      const deal = makeDeal({ termMonths: 6 })
      const receipts = Array.from({ length: 6 }, () =>
        makeReceipt({ payload: { amountUsdc: '100.000000' } }),
      )

      const progress = computeDealProgress(deal, receipts)

      expect(progress.periodsPaid).toBe(6)
      expect(progress.remainingPeriods).toBe(0)
      expect(progress.totalPaidUsdc).toBe('600.000000')
      expect(progress.nextDueDate).toBeNull()
    })
  })

  describe('overpaid deal (more receipts than term)', () => {
    it('clamps remaining to 0', () => {
      const deal = makeDeal({ termMonths: 3 })
      const receipts = Array.from({ length: 5 }, () =>
        makeReceipt({ payload: { amountUsdc: '100.000000' } }),
      )

      const progress = computeDealProgress(deal, receipts)

      expect(progress.periodsPaid).toBe(5)
      expect(progress.remainingPeriods).toBe(0)
      expect(progress.totalPaidUsdc).toBe('500.000000')
    })
  })

  describe('mixed outbox statuses', () => {
    it('only counts SENT TENANT_REPAYMENT items', () => {
      const deal = makeDeal({ termMonths: 6 })
      const receipts = [
        makeReceipt({ payload: { amountUsdc: '50.000000' }, status: OutboxStatus.SENT }),
        makeReceipt({ payload: { amountUsdc: '50.000000' }, status: OutboxStatus.SENT }),
        makeReceipt({ payload: { amountUsdc: '50.000000' }, status: OutboxStatus.PENDING }),
        makeReceipt({ payload: { amountUsdc: '50.000000' }, status: OutboxStatus.FAILED }),
        makeReceipt({ txType: TxType.LANDLORD_PAYOUT, payload: { amountUsdc: '50.000000' }, status: OutboxStatus.SENT }),
      ]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.periodsPaid).toBe(2)
      expect(progress.remainingPeriods).toBe(4)
      expect(progress.totalPaidUsdc).toBe('100.000000')
    })
  })

  describe('different USDC amounts', () => {
    it('sums varying amounts correctly', () => {
      const deal = makeDeal({ termMonths: 3 })
      const receipts = [
        makeReceipt({ payload: { amountUsdc: '25.500000' } }),
        makeReceipt({ payload: { amountUsdc: '75.250000' } }),
        makeReceipt({ payload: { amountUsdc: '100.000000' } }),
      ]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.totalPaidUsdc).toBe('200.750000')
      expect(progress.periodsPaid).toBe(3)
      expect(progress.remainingPeriods).toBe(0)
    })

    it('handles missing amountUsdc gracefully (treats as 0)', () => {
      const deal = makeDeal({ termMonths: 3 })
      const receipts = [
        makeReceipt({ payload: {} }),
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
      ]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.totalPaidUsdc).toBe('50.000000')
      expect(progress.periodsPaid).toBe(2)
    })
  })

  describe('nextDueDate computation', () => {
    it('returns schedule date at index = periodsPaid', () => {
      const deal = makeDeal({ termMonths: 6 })
      const receipts = [makeReceipt(), makeReceipt()]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.nextDueDate).toBe('2024-03-15')
    })

    it('returns null when fully paid', () => {
      const deal = makeDeal({ termMonths: 2 })
      const receipts = [makeReceipt(), makeReceipt()]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.nextDueDate).toBeNull()
    })

    it('returns first due date when no payments made', () => {
      const deal = makeDeal({ termMonths: 4 })

      const progress = computeDealProgress(deal, [])

      expect(progress.nextDueDate).toBe('2024-01-15')
    })
  })

  describe('last payment metadata', () => {
    it('returns lastPaymentTxId and parsed external refs from the last receipt', () => {
      const deal = makeDeal({ termMonths: 3 })
      const lastReceipt = makeReceipt({
        txId: 'tx-last-123',
        canonicalExternalRefV1: 'v1|source=stripe|ref=pi_abc456',
        payload: { amountUsdc: '100.000000' },
      })
      const receipts = [makeReceipt(), makeReceipt(), lastReceipt]

      const progress = computeDealProgress(deal, receipts)

      expect(progress.lastPaymentTxId).toBe('tx-last-123')
      expect(progress.lastPaymentExternalRefSource).toBe('stripe')
      expect(progress.lastPaymentExternalRef).toBe('pi_abc456')
    })

    it('handles legacy format (colon-separated) gracefully', () => {
      const deal = makeDeal({ termMonths: 2 })
      const legacyReceipt = makeReceipt({
        txId: 'tx-legacy',
        canonicalExternalRefV1: 'paystack:pi_legacy_ref',
        payload: { amountUsdc: '50.000000' },
      })

      const progress = computeDealProgress(deal, [legacyReceipt])

      expect(progress.lastPaymentTxId).toBe('tx-legacy')
      expect(progress.lastPaymentExternalRefSource).toBe('paystack')
      expect(progress.lastPaymentExternalRef).toBe('pi_legacy_ref')
    })
  })

  describe('determinism', () => {
    it('returns identical results for identical inputs', () => {
      const deal = makeDeal({ termMonths: 6 })
      const receipts = [
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
        makeReceipt({ payload: { amountUsdc: '50.000000' } }),
      ]

      const first = computeDealProgress(deal, receipts)
      const second = computeDealProgress(deal, receipts)

      expect(first).toEqual(second)
    })
  })

  describe('empty schedule', () => {
    it('returns 0 periods, 0 remaining, and null next due', () => {
      const deal = makeDeal({ termMonths: 0, schedule: [] })

      const progress = computeDealProgress(deal, [])

      expect(progress.periodsPaid).toBe(0)
      expect(progress.remainingPeriods).toBe(0)
      expect(progress.nextDueDate).toBeNull()
    })
  })
})
