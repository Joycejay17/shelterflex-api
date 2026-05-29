/**
 * Per-instalment payment metadata (late fees, outstanding balance).
 * Payment id format: `{dealId}:{period}`.
 */

export interface InstallmentPayment {
  paymentId: string
  dealId: string
  period: number
  originalAmountNgn: number
  lateFeeAmountNgn: number
  lateFeeApplied: boolean
}

class InstallmentPaymentStore {
  private payments = new Map<string, InstallmentPayment>()

  paymentId(dealId: string, period: number): string {
    return `${dealId}:${period}`
  }

  getOrCreate(dealId: string, period: number, originalAmountNgn: number): InstallmentPayment {
    const paymentId = this.paymentId(dealId, period)
    let row = this.payments.get(paymentId)
    if (!row) {
      row = {
        paymentId,
        dealId,
        period,
        originalAmountNgn,
        lateFeeAmountNgn: 0,
        lateFeeApplied: false,
      }
      this.payments.set(paymentId, row)
    }
    return { ...row }
  }

  findByPaymentId(paymentId: string): InstallmentPayment | undefined {
    const row = this.payments.get(paymentId)
    return row ? { ...row } : undefined
  }

  update(paymentId: string, patch: Partial<InstallmentPayment>): InstallmentPayment | undefined {
    const row = this.payments.get(paymentId)
    if (!row) return undefined
    Object.assign(row, patch)
    return { ...row }
  }

  clear(): void {
    this.payments.clear()
  }
}

export const installmentPaymentStore = new InstallmentPaymentStore()
