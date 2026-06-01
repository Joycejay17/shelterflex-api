/**
 * Late payment escalation thresholds — configurable via environment variables.
 */

export interface LatePaymentConfig {
  /** Calendar days after due date when grace ends and late fee applies (T+4 default). */
  lateFeeDay: number
  /** Inclusive grace reminder window: T+1 through this day. */
  gracePeriodDays: number
  /** T+7 — flag deal at_risk. */
  atRiskDay: number
  /** T+14 — admin queue escalation. */
  adminEscalationDay: number
  /** T+30 — auto-default. */
  defaultDay: number
  /** Late fee as a fraction of instalment amount (e.g. 0.02 = 2%). */
  lateFeeRate: number
  /** Job poll interval in ms (default 6 hours). */
  jobPollIntervalMs: number
}

export const DEFAULT_LATE_PAYMENT_CONFIG: LatePaymentConfig = {
  lateFeeDay: 4,
  gracePeriodDays: 3,
  atRiskDay: 7,
  adminEscalationDay: 14,
  defaultDay: 30,
  lateFeeRate: 0.02,
  jobPollIntervalMs: 6 * 60 * 60 * 1000,
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function readRate(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

export function getLatePaymentConfig(): LatePaymentConfig {
  return {
    lateFeeDay: readInt('LATE_PAYMENT_FEE_DAY', DEFAULT_LATE_PAYMENT_CONFIG.lateFeeDay),
    gracePeriodDays: readInt('LATE_PAYMENT_GRACE_DAYS', DEFAULT_LATE_PAYMENT_CONFIG.gracePeriodDays),
    atRiskDay: readInt('LATE_PAYMENT_AT_RISK_DAY', DEFAULT_LATE_PAYMENT_CONFIG.atRiskDay),
    adminEscalationDay: readInt(
      'LATE_PAYMENT_ADMIN_DAY',
      DEFAULT_LATE_PAYMENT_CONFIG.adminEscalationDay,
    ),
    defaultDay: readInt('LATE_PAYMENT_DEFAULT_DAY', DEFAULT_LATE_PAYMENT_CONFIG.defaultDay),
    lateFeeRate: readRate('LATE_PAYMENT_FEE_RATE', DEFAULT_LATE_PAYMENT_CONFIG.lateFeeRate),
    jobPollIntervalMs: readInt(
      'LATE_PAYMENT_JOB_POLL_MS',
      DEFAULT_LATE_PAYMENT_CONFIG.jobPollIntervalMs,
    ),
  }
}

export function validateLatePaymentConfig(config: LatePaymentConfig = getLatePaymentConfig()): void {
  if (config.gracePeriodDays < 1) {
    throw new Error('LATE_PAYMENT_GRACE_DAYS must be at least 1')
  }
  if (config.lateFeeDay <= config.gracePeriodDays) {
    throw new Error('LATE_PAYMENT_FEE_DAY must be greater than grace period end')
  }
  if (!(config.atRiskDay > config.lateFeeDay && config.adminEscalationDay > config.atRiskDay)) {
    throw new Error('Escalation days must increase: lateFee < atRisk < admin < default')
  }
  if (config.defaultDay <= config.adminEscalationDay) {
    throw new Error('LATE_PAYMENT_DEFAULT_DAY must be greater than admin escalation day')
  }
  if (config.lateFeeRate < 0 || config.lateFeeRate > 1) {
    throw new Error('LATE_PAYMENT_FEE_RATE must be between 0 and 1')
  }
}
