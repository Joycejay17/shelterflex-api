import { describe, it, expect, beforeEach } from 'vitest'
import { LateFeeService } from './lateFeeService.js'
import { installmentPaymentStore } from '../models/installmentPaymentStore.js'

describe('LateFeeService', () => {
  const service = new LateFeeService()

  beforeEach(() => {
    installmentPaymentStore.clear()
  })

  it('applies late fee once (idempotent)', () => {
    const paymentId = installmentPaymentStore.paymentId('deal-1', 1)
    installmentPaymentStore.getOrCreate('deal-1', 1, 100_000)

    const first = service.applyLateFee(paymentId, 0.02)
    expect(first.applied).toBe(true)
    expect(first.lateFeeAmountNgn).toBe(2000)

    const second = service.applyLateFee(paymentId, 0.02)
    expect(second.applied).toBe(false)
    expect(second.lateFeeAmountNgn).toBe(2000)
  })

  it('getEffectiveAmount returns original + late fee', () => {
    const paymentId = installmentPaymentStore.paymentId('deal-2', 2)
    installmentPaymentStore.getOrCreate('deal-2', 2, 50_000)
    service.applyLateFee(paymentId, 0.02)
    expect(service.getEffectiveAmount(paymentId)).toBe(51_000)
  })
})
