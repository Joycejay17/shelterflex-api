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

export const reconciliationToleranceAbsorbedMinorTotal = new client.Counter({
  name: 'reconciliation_tolerance_absorbed_minor_total',
  help: 'Total amount (minor units) auto-absorbed by reconciliation tolerance rules. Rising fast = systematic drift being silently absorbed.',
  labelNames: ['rail', 'currency'] as const,
  registers: [metricsRegister],
})

export const reconciliationDriftCapBreachTotal = new client.Counter({
  name: 'reconciliation_drift_cap_breach_total',
  help: 'Times the windowed tolerance-absorption cap was hit, forcing a mismatch to escalate instead of being silently absorbed.',
  labelNames: ['rail', 'currency'] as const,
  registers: [metricsRegister],
})

export function recordPaymentInitiated(provider: string, status: string): void {
  if (isTestEnv) return
  paymentInitiatedTotal.inc({ provider, status })
}

export function recordToleranceAbsorbed(rail: string, currency: string, minor: number): void {
  if (isTestEnv) return
  reconciliationToleranceAbsorbedMinorTotal.inc({ rail, currency }, minor)
}

export function recordDriftCapBreach(rail: string, currency: string): void {
  if (isTestEnv) return
  reconciliationDriftCapBreachTotal.inc({ rail, currency })
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

// ---------------------------------------------------------------------------
// Outbox processor metrics
// ---------------------------------------------------------------------------

export const outboxPendingGauge = new client.Gauge({
  name: 'outbox_pending_count',
  help: 'Number of outbox items currently pending processing',
  registers: [metricsRegister],
})

export const outboxProcessedTotal = new client.Counter({
  name: 'outbox_processed_total',
  help: 'Total number of outbox items processed',
  labelNames: ['status'] as const,
  registers: [metricsRegister],
})

export const outboxFailedTotal = new client.Counter({
  name: 'outbox_failed_total',
  help: 'Total number of outbox items failed or dead-lettered',
  labelNames: ['reason'] as const,
  registers: [metricsRegister],
})

export const outboxProcessingDurationMs = new client.Histogram({
  name: 'outbox_processing_duration_ms',
  help: 'Outbox item processing duration in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegister],
})

export function recordOutboxPending(count: number): void {
  if (isTestEnv) return
  outboxPendingGauge.set(count)
}

export function recordOutboxProcessed(status: string): void {
  if (isTestEnv) return
  outboxProcessedTotal.inc({ status })
}

export function recordOutboxFailed(reason: string): void {
  if (isTestEnv) return
  outboxFailedTotal.inc({ reason })
}

export function recordOutboxProcessingDuration(durationMs: number): void {
  if (isTestEnv) return
  outboxProcessingDurationMs.observe(durationMs)
}

// ---------------------------------------------------------------------------
// Settlement processor metrics
// ---------------------------------------------------------------------------

export const settlementPendingGauge = new client.Gauge({
  name: 'settlement_pending_count',
  help: 'Number of settlement outbox items currently pending processing',
  registers: [metricsRegister],
})

export const settlementProcessedTotal = new client.Counter({
  name: 'settlement_processed_total',
  help: 'Total number of settlement outbox items processed',
  labelNames: ['status'] as const,
  registers: [metricsRegister],
})

export const settlementFailedTotal = new client.Counter({
  name: 'settlement_failed_total',
  help: 'Total number of settlement outbox items failed or dead-lettered',
  labelNames: ['reason'] as const,
  registers: [metricsRegister],
})

export const settlementProcessingDurationMs = new client.Histogram({
  name: 'settlement_processing_duration_ms',
  help: 'Settlement outbox item processing duration in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegister],
})

export function recordSettlementPending(count: number): void {
  if (isTestEnv) return
  settlementPendingGauge.set(count)
}

export function recordSettlementProcessed(status: string): void {
  if (isTestEnv) return
  settlementProcessedTotal.inc({ status })
}

export function recordSettlementFailed(reason: string): void {
  if (isTestEnv) return
  settlementFailedTotal.inc({ reason })
}

export function recordSettlementProcessingDuration(durationMs: number): void {
  if (isTestEnv) return
  settlementProcessingDurationMs.observe(durationMs)
}

// ---------------------------------------------------------------------------
// Reconciliation processor metrics
// ---------------------------------------------------------------------------

export const reconciliationPendingGauge = new client.Gauge({
  name: 'reconciliation_pending_count',
  help: 'Number of ledger events pending reconciliation',
  registers: [metricsRegister],
})

export const reconciliationProcessedTotal = new client.Counter({
  name: 'reconciliation_processed_total',
  help: 'Total number of ledger events processed by reconciliation',
  labelNames: ['status'] as const,
  registers: [metricsRegister],
})

export const reconciliationMismatchesTotal = new client.Counter({
  name: 'reconciliation_mismatches_total',
  help: 'Total number of reconciliation mismatches detected',
  labelNames: ['mismatch_class'] as const,
  registers: [metricsRegister],
})

export const reconciliationProcessingDurationMs = new client.Histogram({
  name: 'reconciliation_processing_duration_ms',
  help: 'Reconciliation pass processing duration in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegister],
})

export function recordReconciliationPending(count: number): void {
  if (isTestEnv) return
  reconciliationPendingGauge.set(count)
}

export function recordReconciliationProcessed(status: string): void {
  if (isTestEnv) return
  reconciliationProcessedTotal.inc({ status })
}

export function recordReconciliationMismatch(mismatchClass: string): void {
  if (isTestEnv) return
  reconciliationMismatchesTotal.inc({ mismatch_class: mismatchClass })
}

export function recordReconciliationProcessingDuration(durationMs: number): void {
  if (isTestEnv) return
  reconciliationProcessingDurationMs.observe(durationMs)
}
