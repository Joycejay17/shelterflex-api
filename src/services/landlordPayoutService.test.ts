import { describe, it, expect } from 'vitest'
import {
  computePayoutScheduleFromInput,
  deriveInstalmentAmounts,
  toDeductions,
  DEFAULT_LANDLORD_PAYOUT_CONFIG,
} from './landlordPayoutService.js'

describe('deriveInstalmentAmounts', () => {
  it('splits evenly when divisible', () => {
    expect(deriveInstalmentAmounts(600000, 6)).toEqual([100000, 100000, 100000, 100000, 100000, 100000])
  })

  it('folds the rounding remainder into the final instalment', () => {
    const parts = deriveInstalmentAmounts(100000, 3)
    expect(parts).toEqual([33333, 33333, 33334])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100000)
  })

  it('rejects invalid terms', () => {
    expect(() => deriveInstalmentAmounts(1000, 0)).toThrow()
    expect(() => deriveInstalmentAmounts(-1, 6)).toThrow()
  })
})

describe('computePayoutScheduleFromInput', () => {
  it('produces one landlord payout per instalment plus the upfront line (6-month plan)', () => {
    const instalments = deriveInstalmentAmounts(600000, 6)
    const schedule = computePayoutScheduleFromInput({
      dealId: 'deal-1',
      landlordId: 'landlord-1',
      depositNgn: 500000,
      instalmentAmountsNgn: instalments,
    })

    expect(schedule.lines).toHaveLength(7) // 1 upfront + 6 instalments
    expect(schedule.lines.filter((l) => l.kind === 'instalment')).toHaveLength(6)
    expect(schedule.lines[0].kind).toBe('upfront')
    expect(schedule.lines.slice(1).map((l) => l.instalmentNumber)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('pays 80% of the deposit upfront and keeps 20% as platform fee by default', () => {
    const schedule = computePayoutScheduleFromInput({
      dealId: 'deal-2',
      landlordId: 'landlord-2',
      depositNgn: 500000,
      instalmentAmountsNgn: [],
    })
    const upfront = schedule.lines[0]
    expect(upfront.netAmount).toBe(400000)
    expect(upfront.platformFee).toBe(100000)
    expect(upfront.grossAmount).toBe(500000)
  })

  it('records gross and net separately, deducting the platform fee per instalment', () => {
    const schedule = computePayoutScheduleFromInput({
      dealId: 'deal-3',
      landlordId: 'landlord-3',
      depositNgn: 0,
      instalmentAmountsNgn: [100000, 100000],
    })
    for (const line of schedule.lines.filter((l) => l.kind === 'instalment')) {
      expect(line.grossAmount).toBe(100000)
      expect(line.platformFee).toBe(20000)
      expect(line.netAmount).toBe(80000)
      expect(line.netAmount).not.toBe(line.grossAmount)
    }
    // Totals reconcile.
    expect(schedule.totals.gross).toBe(200000)
    expect(schedule.totals.platformFee).toBe(40000)
    expect(schedule.totals.net).toBe(160000)
  })

  it('handles 3- and 12-month plans', () => {
    for (const term of [3, 12]) {
      const instalments = deriveInstalmentAmounts(term * 50000, term)
      const schedule = computePayoutScheduleFromInput({
        dealId: `deal-${term}`,
        landlordId: 'landlord',
        depositNgn: 200000,
        instalmentAmountsNgn: instalments,
      })
      expect(schedule.lines.filter((l) => l.kind === 'instalment')).toHaveLength(term)
    }
  })

  it('is deterministic / idempotent for identical input', () => {
    const input = {
      dealId: 'deal-x',
      landlordId: 'landlord-x',
      depositNgn: 300000,
      instalmentAmountsNgn: [50000, 50000, 50000],
    }
    expect(computePayoutScheduleFromInput(input)).toEqual(computePayoutScheduleFromInput(input))
  })

  it('respects a custom fee config', () => {
    const schedule = computePayoutScheduleFromInput(
      { dealId: 'd', landlordId: 'l', depositNgn: 100000, instalmentAmountsNgn: [100000] },
      { upfrontDepositShare: 0.9, instalmentPlatformFeeShare: 0.1 },
    )
    expect(schedule.lines[0].netAmount).toBe(90000)
    expect(schedule.lines[1].platformFee).toBe(10000)
  })
})

describe('toDeductions', () => {
  it('emits a platform_fee deduction when a fee was charged', () => {
    expect(toDeductions({ kind: 'instalment', instalmentNumber: 1, grossAmount: 100000, platformFee: 20000, netAmount: 80000 })).toEqual([
      { type: 'platform_fee', label: 'Platform Fee', amount: 20000 },
    ])
  })

  it('emits no deductions when there is no fee', () => {
    expect(toDeductions({ kind: 'upfront', grossAmount: 0, platformFee: 0, netAmount: 0 })).toEqual([])
  })
})

describe('DEFAULT_LANDLORD_PAYOUT_CONFIG', () => {
  it('defaults to 80% upfront / 20% instalment fee', () => {
    expect(DEFAULT_LANDLORD_PAYOUT_CONFIG).toEqual({ upfrontDepositShare: 0.8, instalmentPlatformFeeShare: 0.2 })
  })
})
