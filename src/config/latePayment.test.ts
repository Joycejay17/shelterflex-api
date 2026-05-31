import { describe, it, expect } from 'vitest'
import { DEFAULT_LATE_PAYMENT_CONFIG, validateLatePaymentConfig } from './latePayment.js'

describe('latePayment config', () => {
  it('validates default config', () => {
    expect(() => validateLatePaymentConfig(DEFAULT_LATE_PAYMENT_CONFIG)).not.toThrow()
  })

  it('rejects invalid escalation ordering', () => {
    expect(() =>
      validateLatePaymentConfig({
        ...DEFAULT_LATE_PAYMENT_CONFIG,
        atRiskDay: 2,
      }),
    ).toThrow()
  })
})
