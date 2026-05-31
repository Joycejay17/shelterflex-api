import { outboxStore } from './store.js'
import { OutboxSender } from './sender.js'
import { OutboxStatus, type OutboxItem } from './types.js'
import { outboxProcessor } from '../services/outboxProcessor.js'
import { outboxConfig } from '../config/outboxConfig.js'
import { logger } from '../utils/logger.js'

export class OutboxWorker {
  private intervalId: NodeJS.Timeout | null = null
  private running = false
  private sender: OutboxSender
  private processingPromise: Promise<void> | null = null

  constructor(sender: OutboxSender) {
    this.sender = sender
  }

  start(intervalMs = 60000) {
    if (this.running) return
    this.running = true
    this.intervalId = setInterval(() => {
      this.processingPromise = this.process().finally(() => {
        this.processingPromise = null
      })
    }, intervalMs)
    logger.info('OutboxWorker started', { intervalMs, config: outboxConfig })
  }

  async stop() {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.processingPromise) {
      logger.info('OutboxWorker waiting for in-progress task to complete...')
      await this.processingPromise
    }
    logger.info('OutboxWorker stopped')
  }

  async process() {
    // 1) First delivery attempt for all pending items
    const pending = await outboxStore.listByStatus(OutboxStatus.PENDING)
    for (const item of pending) {
      logger.info('Processing pending outbox item', {
        outboxId: item.id,
        txType: item.txType,
        txId: item.txId,
      })
      await this.attemptSend(item)
    }

    // 2) Retry eligible failed items; promote exhausted items to DLQ
    const failed = await outboxStore.listByStatus(OutboxStatus.FAILED)
    for (const item of failed) {
      if (item.retryCount >= outboxConfig.maxAttempts) {
        await outboxProcessor.promoteToDeadLetter(item, 'Max retry count reached')
        continue
      }
      if (!outboxProcessor.shouldRetry(item)) continue

      logger.info('Retrying failed outbox item', {
        outboxId: item.id,
        txId: item.txId,
        retryCount: item.retryCount,
        lastError: item.lastError,
      })
      await this.attemptSend(item)
    }
  }

  private async attemptSend(item: OutboxItem): Promise<void> {
    const success = await this.sender.send(item)
    if (!success) {
      const error = item.lastError ?? 'Send failed'
      await outboxProcessor.scheduleRetry(item, error)
    }
  }
}
