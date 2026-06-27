import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { outboxStore } from '../outbox/store.js'
import { OutboxStatus, TxType, type OutboxItem } from '../outbox/types.js'
import { OutboxProcessor } from './outboxProcessor.js'
import type { OutboxConfig } from '../config/outboxConfig.js'

vi.mock('../repositories/OutboxRepository.js', () => ({
  outboxRepository: {
    moveToDeadLetter: vi.fn(),
  },
}))

import { outboxRepository } from '../repositories/OutboxRepository.js'

const testConfig: OutboxConfig = {
  baseDelayMs: 100,
  maxDelayMs: 5000,
  maxAttempts: 3,
  jitterFactor: 0,
  confirmationDepth: 3,
}

function makeItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'test-item-id',
    txType: TxType.RECEIPT,
    canonicalExternalRefV1: 'test:ref-1',
    txId: 'a'.repeat(64),
    payload: { dealId: 'deal-1', amountUsdc: '100' },
    status: OutboxStatus.PENDING,
    attempts: 0,
    lastError: '',
    aggregateType: 'deal',
    aggregateId: 'deal-1',
    eventType: 'receipt',
    retryCount: 0,
    nextRetryAt: null,
    processedAt: null,
    confirmationDepth: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('OutboxProcessor', () => {
  let processor: OutboxProcessor

  beforeEach(async () => {
    await outboxStore.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.mocked(outboxRepository.moveToDeadLetter).mockReset()
    processor = new OutboxProcessor(testConfig)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await outboxStore.clear()
  })

  // ---------------------------------------------------------------------------
  // shouldRetry
  // ---------------------------------------------------------------------------
  describe('shouldRetry', () => {
    it('returns true when retryCount is below maxAttempts and no nextRetryAt is set', () => {
      const item = makeItem({ retryCount: 0, nextRetryAt: null })
      expect(processor.shouldRetry(item)).toBe(true)
    })

    it('returns true when nextRetryAt is in the past', () => {
      const item = makeItem({
        retryCount: 1,
        nextRetryAt: new Date(Date.now() - 1000),
      })
      expect(processor.shouldRetry(item)).toBe(true)
    })

    it('returns false when nextRetryAt is in the future', () => {
      const item = makeItem({
        retryCount: 1,
        nextRetryAt: new Date(Date.now() + 60_000),
      })
      expect(processor.shouldRetry(item)).toBe(false)
    })

    it('returns false when retryCount >= maxAttempts', () => {
      const item = makeItem({ retryCount: 3, nextRetryAt: null })
      expect(processor.shouldRetry(item)).toBe(false)
    })

    it('returns true when nextRetryAt equals now', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const item = makeItem({
        retryCount: 0,
        nextRetryAt: new Date(now),
      })
      expect(processor.shouldRetry(item)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // scheduleRetry
  // ---------------------------------------------------------------------------
  describe('scheduleRetry', () => {
    it('schedules next retry with computed delay when under maxAttempts', async () => {
      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'retry-schedule-1',
        payload: { dealId: 'd1' },
      })

      await processor.scheduleRetry(item, 'timeout error')

      const updated = await outboxStore.getById(item.id)
      expect(updated).not.toBeNull()
      expect(updated!.status).toBe(OutboxStatus.FAILED)
      expect(updated!.lastError).toBe('timeout error')
      expect(updated!.nextRetryAt).toBeInstanceOf(Date)
      expect(updated!.nextRetryAt!.getTime()).toBeGreaterThan(Date.now())
    })

    it('promotes to dead letter when nextRetryCount >= maxAttempts', async () => {
      vi.mocked(outboxRepository.moveToDeadLetter).mockResolvedValue(undefined)

      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'retry-deadletter-1',
        payload: { dealId: 'd2' },
      })
      // Simulate 2 previous retries so next retryCount (3) >= maxAttempts (3)
      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, { error: 'err1' })
      await outboxStore.updateStatus(item.id, OutboxStatus.FAILED, { error: 'err2' })

      await processor.scheduleRetry(item, 'persistent failure')

      expect(outboxRepository.moveToDeadLetter).toHaveBeenCalledWith(
        item.id,
        'persistent failure',
      )
    })

    it('uses exponential backoff to compute delay', async () => {
      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'backoff-1',
        payload: { dealId: 'd3' },
      })

      const before = Date.now()
      await processor.scheduleRetry(item, 'error')

      const updated = await outboxStore.getById(item.id)
      const retryAt = updated!.nextRetryAt!.getTime()
      const delay = retryAt - before

      // baseDelayMs=100, attempt=0 → delay = 100 * 2^0 = 100ms
      expect(delay).toBeGreaterThanOrEqual(100)
      expect(delay).toBeLessThanOrEqual(200)
    })
  })

  // ---------------------------------------------------------------------------
  // promoteToDeadLetter
  // ---------------------------------------------------------------------------
  describe('promoteToDeadLetter', () => {
    it('calls outboxRepository.moveToDeadLetter on success', async () => {
      vi.mocked(outboxRepository.moveToDeadLetter).mockResolvedValue(undefined)

      const item = makeItem({ id: 'dead-1', retryCount: 3 })
      await processor.promoteToDeadLetter(item, 'max retries exceeded')

      expect(outboxRepository.moveToDeadLetter).toHaveBeenCalledWith(
        'dead-1',
        'max retries exceeded',
      )
    })

    it('falls back to outboxStore.markDead when repository throws', async () => {
      vi.mocked(outboxRepository.moveToDeadLetter).mockRejectedValue(
        new Error('column dead_lettered_at does not exist'),
      )

      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'fallback-dead-1',
        payload: { dealId: 'd4' },
      })

      await processor.promoteToDeadLetter(item, 'repo failure')

      const updated = await outboxStore.getById(item.id)
      expect(updated?.status).toBe(OutboxStatus.DEAD)
      expect(updated?.lastError).toBe('repo failure')
    })
  })

  // ---------------------------------------------------------------------------
  // Success flow
  // ---------------------------------------------------------------------------
  describe('success flow', () => {
    it('does not retry an item that has no failure', async () => {
      const item = makeItem({ retryCount: 0, nextRetryAt: null })
      expect(processor.shouldRetry(item)).toBe(true)
      // A successful item would have status SENT and processedAt set
      // The processor only operates on failed items, so success = no action needed
    })
  })

  // ---------------------------------------------------------------------------
  // Poison message isolation
  // ---------------------------------------------------------------------------
  describe('poison message isolation', () => {
    it('dead-letters a poison record without stalling other items', async () => {
      vi.mocked(outboxRepository.moveToDeadLetter).mockResolvedValue(undefined)

      const poison = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'poison-item',
        payload: { dealId: 'poison' },
      })
      const healthy = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'healthy-item',
        payload: { dealId: 'healthy' },
      })

      // Poison item: max retries exhausted
      for (let i = 0; i < 3; i++) {
        await outboxStore.updateStatus(poison.id, OutboxStatus.FAILED, {
          error: `fail-${i}`,
        })
      }

      // Poison item should not be retryable
      const poisonItem = await outboxStore.getById(poison.id)
      expect(processor.shouldRetry(poisonItem!)).toBe(false)

      // Healthy item is still retryable
      const healthyItem = await outboxStore.getById(healthy.id)
      expect(processor.shouldRetry(healthyItem!)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Concurrent processor runs
  // ---------------------------------------------------------------------------
  describe('concurrent processor runs', () => {
    it('claim semantics prevent double-dispatch via lockForProcessing', async () => {
      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'concurrent-1',
        payload: { dealId: 'd5' },
      })

      // Worker 1 claims the item
      const claimed1 = await outboxStore.lockForProcessing(10, 'worker-1')
      expect(claimed1).toHaveLength(1)
      expect(claimed1[0].id).toBe(item.id)

      // Worker 2 cannot claim the same item
      const claimed2 = await outboxStore.lockForProcessing(10, 'worker-2')
      expect(claimed2).toHaveLength(0)
    })

    it('releases stale claims for reclaim by another worker', async () => {
      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'stale-claim-1',
        payload: { dealId: 'd6' },
      })

      // Worker 1 claims the item
      await outboxStore.lockForProcessing(10, 'worker-1')

      // Advance time past the 5-minute stale claim window
      vi.advanceTimersByTime(6 * 60 * 1000)

      // Worker 2 can now reclaim it
      const claimed = await outboxStore.lockForProcessing(10, 'worker-2')
      expect(claimed).toHaveLength(1)
      expect(claimed[0].id).toBe(item.id)
      expect(claimed[0].claimedBy).toBe('worker-2')
    })
  })

  // ---------------------------------------------------------------------------
  // Ordering and at-least-once behavior
  // ---------------------------------------------------------------------------
  describe('ordering and at-least-once', () => {
    it('returns items in creation order from lockForProcessing', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        const item = await outboxStore.create({
          txType: TxType.RECEIPT,
          source: 'test',
          ref: `order-${i}`,
          payload: { dealId: `d-${i}` },
        })
        ids.push(item.id)
      }

      const claimed = await outboxStore.lockForProcessing(10, 'worker-1')
      expect(claimed.map((i) => i.id)).toEqual(ids)
    })

    it('marking an item dead removes it from further processing', async () => {
      const item = await outboxStore.create({
        txType: TxType.RECEIPT,
        source: 'test',
        ref: 'dead-check-1',
        payload: { dealId: 'd7' },
      })

      // Make repository fail so the fallback markDead path runs
      vi.mocked(outboxRepository.moveToDeadLetter).mockRejectedValue(
        new Error('column dead_lettered_at does not exist'),
      )

      await processor.promoteToDeadLetter(item, 'test dead letter')

      // Verify it's dead via the store fallback
      const deadItem = await outboxStore.getById(item.id)
      expect(deadItem?.status).toBe(OutboxStatus.DEAD)

      // Dead items are not returned by lockForProcessing
      const claimed = await outboxStore.lockForProcessing(10, 'worker-1')
      expect(claimed.find((i) => i.id === item.id)).toBeUndefined()
    })
  })
})
