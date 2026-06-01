import { installmentPaymentStore } from '../models/installmentPaymentStore.js'

export class LateFeeService {
  /**
   * Apply a late fee to an instalment. Idempotent — will not apply twice.
   */
  applyLateFee(paymentId: string, rate: number): { applied: boolean; lateFeeAmountNgn: number } {
    const payment = installmentPaymentStore.findByPaymentId(paymentId)
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`)
    }
    if (payment.lateFeeApplied) {
      return { applied: false, lateFeeAmountNgn: payment.lateFeeAmountNgn }
    }

    const lateFeeAmountNgn = Math.round(payment.originalAmountNgn * rate * 100) / 100
    installmentPaymentStore.update(paymentId, {
      lateFeeAmountNgn,
      lateFeeApplied: true,
    })

    return { applied: true, lateFeeAmountNgn }
  }

  getEffectiveAmount(paymentId: string): number {
    const payment = installmentPaymentStore.findByPaymentId(paymentId)
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`)
    }
    return payment.originalAmountNgn + payment.lateFeeAmountNgn
  }

  ensurePaymentRecord(dealId: string, period: number, originalAmountNgn: number): string {
    const paymentId = installmentPaymentStore.paymentId(dealId, period)
    installmentPaymentStore.getOrCreate(dealId, period, originalAmountNgn)
    return paymentId
  }
}

export const lateFeeService = new LateFeeService()
