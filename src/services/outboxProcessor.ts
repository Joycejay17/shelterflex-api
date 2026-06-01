/**
 * Outbox Processor
 *
 * Encapsulates the retry-scheduling and dead-letter promotion logic for outbox items.
 * The worker delegates all retry decisions to this module so the policy is testable
 * independently of the poll/dispatch loop.
 *
 * Retry policy: exponential backoff with full jitter
 *   delay = min(baseDelayMs * 2^attempt, maxDelayMs)
 *   jitter = Math.random() * jitterFactor * delay
 *   next_retry_at = now + delay + jitter
 *
 * Dead-letter promotion: any item that has reached maxAttempts without success
 * is moved to the DLQ and will no longer be processed automatically.
 */

import { outboxStore } from '../outbox/store.js'
import { OutboxStatus, type OutboxItem } from '../outbox/types.js'
import { outboxRepository } from '../repositories/OutboxRepository.js'
import { computeRetryDelay, outboxConfig, type OutboxConfig } from '../config/outboxConfig.js'
import { logger } from '../utils/logger.js'

export class OutboxProcessor {
  private config: OutboxConfig

  constructor(config: OutboxConfig = outboxConfig) {
    this.config = config
  }

  /**
   * Determine whether a failed item is eligible for retry right now.
   * Returns false when the item has exceeded maxAttempts or its nextRetryAt
   * is still in the future.
   */
  shouldRetry(item: OutboxItem): boolean {
    if (item.retryCount >= this.config.maxAttempts) return false
    if (!item.nextRetryAt) return true
    return Date.now() >= new Date(item.nextRetryAt).getTime()
  }

  /**
   * Schedule the next retry for a failed item using exponential backoff + jitter.
   * If the item has exhausted maxAttempts it is promoted to the dead-letter queue instead.
   */
  async scheduleRetry(item: OutboxItem, error: string): Promise<void> {
    const nextRetryCount = item.retryCount + 1

    if (nextRetryCount >= this.config.maxAttempts) {
      await this.promoteToDeadLetter(item, error)
      return
    }

    const delayMs = computeRetryDelay(item.retryCount, this.config)
    const nextRetryAt = new Date(Date.now() + delayMs)

    logger.info('Scheduling outbox retry', {
      outboxId: item.id,
      txId: item.txId,
      attempt: nextRetryCount,
      delayMs,
      nextRetryAt: nextRetryAt.toISOString(),
    })

    await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, {
      error,
      nextRetryAt,
    })
  }

  /**
   * Move an item to the dead-letter queue.
   * Uses OutboxRepository so the dead_lettered_at column is recorded.
   */
  async promoteToDeadLetter(item: OutboxItem, reason: string): Promise<void> {
    logger.warn('Promoting outbox item to dead-letter queue', {
      outboxId: item.id,
      txId: item.txId,
      retryCount: item.retryCount,
      reason,
    })

    try {
      await outboxRepository.moveToDeadLetter(item.id, reason)
    } catch {
      // Fall back to the store's markDead if the repository call fails
      // (e.g., dead_lettered_at column not yet migrated in a dev environment)
      await outboxStore.markDead(item.id, reason)
    }
  }
}

export const outboxProcessor = new OutboxProcessor()
