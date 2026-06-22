import { describe, expect, it } from 'vitest'
import { monotonicPaymentStatus } from './paymentState.js'

describe('monotonicPaymentStatus', () => {
  it('keeps reversal terminal when stale events arrive later', () => {
    expect(monotonicPaymentStatus('reversed', 'pending')).toBe('reversed')
    expect(monotonicPaymentStatus('reversed', 'confirmed')).toBe('reversed')
    expect(monotonicPaymentStatus('reversed', 'failed')).toBe('reversed')
  })

  it('does not let stale pending or failed events overwrite confirmation', () => {
    expect(monotonicPaymentStatus('confirmed', 'pending')).toBe('confirmed')
    expect(monotonicPaymentStatus('confirmed', 'failed')).toBe('confirmed')
  })

  it('converges to reversal regardless of arrival order', () => {
    const events = ['pending', 'confirmed', 'reversed'] as const
    const forward = events.reduce(monotonicPaymentStatus)
    const reverse = [...events].reverse().reduce(monotonicPaymentStatus)
    expect(forward).toBe('reversed')
    expect(reverse).toBe('reversed')
  })
})
