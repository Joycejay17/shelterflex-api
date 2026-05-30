import client from 'prom-client'

const isTestEnv = process.env.NODE_ENV === 'test'

export const metricsRegister = new client.Registry()

if (!isTestEnv) {
  client.collectDefaultMetrics({ register: metricsRegister })
}

export const paymentInitiatedTotal = new client.Counter({
  name: 'payment_initiated_total',
  help: 'Total payment initiations',
  labelNames: ['provider', 'status'] as const,
  registers: [metricsRegister],
})

export const dealActivationDurationMs = new client.Histogram({
  name: 'deal_activation_duration_ms',
  help: 'Deal activation end-to-end latency in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegister],
})

export const kycSubmissionTotal = new client.Counter({
  name: 'kyc_submission_total',
  help: 'Total KYC submissions',
  labelNames: ['status'] as const,
  registers: [metricsRegister],
})

export const latePaymentEscalationTotal = new client.Counter({
  name: 'late_payment_escalation_total',
  help: 'Total late payment escalations',
  labelNames: ['escalation_step'] as const,
  registers: [metricsRegister],
})

export function recordPaymentInitiated(provider: string, status: string): void {
  if (isTestEnv) return
  paymentInitiatedTotal.inc({ provider, status })
}

export function recordDealActivationDuration(durationMs: number): void {
  if (isTestEnv) return
  dealActivationDurationMs.observe(durationMs)
}

export function recordKycSubmission(status: string): void {
  if (isTestEnv) return
  kycSubmissionTotal.inc({ status })
}

export function recordLatePaymentEscalation(escalationStep: string): void {
  if (isTestEnv) return
  latePaymentEscalationTotal.inc({ escalation_step: escalationStep })
}
