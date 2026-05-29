/**
 * Idempotency for late-payment escalation steps per instalment per calendar day.
 */

export type EscalationStep =
  | 't0_due_today'
  | 't_grace_reminder'
  | 't4_late_fee'
  | 't7_at_risk'
  | 't14_admin_escalation'
  | 't30_default'

class LatePaymentEscalationStore {
  /** key: `${paymentId}:${step}:${yyyy-mm-dd}` */
  private applied = new Set<string>()

  private key(paymentId: string, step: EscalationStep, day: string): string {
    return `${paymentId}:${step}:${day}`
  }

  hasApplied(paymentId: string, step: EscalationStep, day: string): boolean {
    return this.applied.has(this.key(paymentId, step, day))
  }

  /** Returns true if this is the first application for (paymentId, step, day). */
  markApplied(paymentId: string, step: EscalationStep, day: string): boolean {
    const k = this.key(paymentId, step, day)
    if (this.applied.has(k)) return false
    this.applied.add(k)
    return true
  }

  /** Step-level idempotency (e.g. late fee once ever per payment). */
  private stepKey(paymentId: string, step: EscalationStep): string {
    return `${paymentId}:${step}:once`
  }

  hasStepOnce(paymentId: string, step: EscalationStep): boolean {
    return this.applied.has(this.stepKey(paymentId, step))
  }

  markStepOnce(paymentId: string, step: EscalationStep): boolean {
    const k = this.stepKey(paymentId, step)
    if (this.applied.has(k)) return false
    this.applied.add(k)
    return true
  }

  clear(): void {
    this.applied.clear()
  }
}

export const latePaymentEscalationStore = new LatePaymentEscalationStore()

export function calendarDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function daysPastDue(dueDateIso: string, now: Date): number {
  const due = new Date(dueDateIso)
  const dueStart = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  const nowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor((nowStart - dueStart) / (24 * 60 * 60 * 1000))
}
