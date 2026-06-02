/**
 * Outbox processor tuning knobs.
 *
 * All values can be overridden via environment variables for ops flexibility.
 * Centralised here so the worker and any future processors share a single source of truth.
 */

export const outboxConfig = {
  /** Base delay for the first retry attempt (ms). */
  baseDelayMs: parseInt(process.env.OUTBOX_BASE_DELAY_MS ?? '1000', 10),

  /** Maximum delay cap for any single retry (ms). Defaults to 5 minutes. */
  maxDelayMs: parseInt(process.env.OUTBOX_MAX_DELAY_MS ?? '300000', 10),

  /** Number of delivery attempts before an item is moved to the dead-letter queue. */
  maxAttempts: parseInt(process.env.OUTBOX_MAX_ATTEMPTS ?? '8', 10),

  /**
   * Jitter factor applied to the computed delay.
   * Final jitter added = Math.random() * jitterFactor * computedDelay  (full-jitter strategy).
   */
  jitterFactor: parseFloat(process.env.OUTBOX_JITTER_FACTOR ?? '0.2'),
} as const

export type OutboxConfig = typeof outboxConfig

/**
 * Compute the next retry delay using exponential backoff + full jitter.
 *
 * delay = min(baseDelayMs * 2^attempt, maxDelayMs)
 * jitter = Math.random() * jitterFactor * delay
 * result = delay + jitter
 *
 * Attempt numbering starts at 0 (first retry after the initial failure).
 */
export function computeRetryDelay(
  attempt: number,
  config: OutboxConfig = outboxConfig,
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt)
  const capped = Math.min(exponential, config.maxDelayMs)
  const jitter = Math.random() * config.jitterFactor * capped
  return Math.round(capped + jitter)
}
