import { describe, it, expect, beforeEach } from 'vitest'
import { StubTimelockRepository, type TimelockTransaction, type TimelockStatus } from './timelock-repository.js'

describe('TimelockRepository', () => {
  let repository: StubTimelockRepository

  beforeEach(() => {
    repository = new StubTimelockRepository()
  })

  describe('Persistence and retrieval', () => {
    it('upserses and retrieves timelock transactions', async () => {
      const tx: Partial<TimelockTransaction> & { txHash: string; ledger: number } = {
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: ['arg1'],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      }

      await repository.upsert(tx)
      const all = await repository.findAll()

      expect(all).toHaveLength(1)
      expect(all[0].txHash).toBe('hash1')
      expect(all[0].target).toBe('target1')
      expect(all[0].functionName).toBe('func1')
      expect(all[0].status).toBe('queued')
    })

    it('updates existing transaction on upsert', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      // Upsert with partial update
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1_updated',
        ledger: 101,
      })

      const all = await repository.findAll()
      expect(all).toHaveLength(1)
      expect(all[0].target).toBe('target1_updated')
      expect(all[0].functionName).toBe('func1') // Preserved from first insert
    })

    it('preserves existing values when upserting partial data', async () => {
      const originalArgs = ['arg1', 'arg2']
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: originalArgs,
        eta: 5000,
        status: 'queued',
        ledger: 100,
      })

      // Partial update - only update target
      await repository.upsert({
        txHash: 'hash1',
        target: 'target2',
        ledger: 101,
      })

      const all = await repository.findAll()
      expect(all[0].args).toEqual(originalArgs)
      expect(all[0].eta).toBe(5000)
    })
  })

  describe('Status transitions', () => {
    it('handles queued -> executed transition', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      await repository.updateStatus('hash1', 'executed', 101)

      const all = await repository.findAll()
      expect(all[0].status).toBe('executed')
      expect(all[0].ledger).toBe(101)
    })

    it('handles queued -> cancelled transition', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      await repository.updateStatus('hash1', 'cancelled', 102)

      const all = await repository.findAll()
      expect(all[0].status).toBe('cancelled')
    })

    it('handles multiple status transitions in sequence', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      // Transition 1: queued -> some intermediate state would be theoretical
      // For this system: queued -> executed
      await repository.updateStatus('hash1', 'executed', 101)
      let all = await repository.findAll()
      expect(all[0].status).toBe('executed')

      // Verify we can still find it
      expect(all[0].txHash).toBe('hash1')
    })

    it('ignores updateStatus for non-existent transactions', async () => {
      // Should not throw
      await repository.updateStatus('nonexistent', 'executed', 100)

      const all = await repository.findAll()
      expect(all).toHaveLength(0)
    })

    it('updates ledger on status change', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      await repository.updateStatus('hash1', 'executed', 150)

      const all = await repository.findAll()
      expect(all[0].ledger).toBe(150)
    })
  })

  describe('Timestamp management', () => {
    it('sets createdAt on first insert', async () => {
      const beforeInsert = Date.now()
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })
      const afterInsert = Date.now()

      const all = await repository.findAll()
      expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(beforeInsert)
      expect(all[0].createdAt.getTime()).toBeLessThanOrEqual(afterInsert)
    })

    it('updates updatedAt on each modification', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      let all = await repository.findAll()
      const firstUpdate = all[0].updatedAt.getTime()

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 10))

      // Update
      await repository.updateStatus('hash1', 'executed', 101)
      all = await repository.findAll()
      const secondUpdate = all[0].updatedAt.getTime()

      expect(secondUpdate).toBeGreaterThanOrEqual(firstUpdate)
    })

    it('preserves createdAt on updates', async () => {
      const beforeInsert = Date.now()
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })
      let all = await repository.findAll()
      const originalCreatedAt = all[0].createdAt.getTime()

      await new Promise(resolve => setTimeout(resolve, 10))

      await repository.updateStatus('hash1', 'executed', 101)
      all = await repository.findAll()

      // createdAt should not change
      expect(all[0].createdAt.getTime()).toBe(originalCreatedAt)
    })
  })

  describe('Checkpoint persistence', () => {
    it('saves and retrieves checkpoint', async () => {
      await repository.saveCheckpoint(500)
      const checkpoint = await repository.getCheckpoint()

      expect(checkpoint).toBe(500)
    })

    it('returns null when no checkpoint exists', async () => {
      const checkpoint = await repository.getCheckpoint()
      expect(checkpoint).toBeNull()
    })

    it('updates checkpoint value', async () => {
      await repository.saveCheckpoint(100)
      expect(await repository.getCheckpoint()).toBe(100)

      await repository.saveCheckpoint(200)
      expect(await repository.getCheckpoint()).toBe(200)
    })

    it('handles checkpoint across multiple operations', async () => {
      // Start from checkpoint 1000
      await repository.saveCheckpoint(1000)

      // Process some transactions
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 1001,
      })

      // Update checkpoint to next ledger
      await repository.saveCheckpoint(1001)

      const checkpoint = await repository.getCheckpoint()
      expect(checkpoint).toBe(1001)
    })
  })

  describe('Idempotency and duplicate handling', () => {
    it('is idempotent on duplicate upserts', async () => {
      const tx = {
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: ['arg1'],
        eta: 1000,
        status: 'queued' as const,
        ledger: 100,
      }

      await repository.upsert(tx)
      await repository.upsert(tx)
      await repository.upsert(tx)

      const all = await repository.findAll()
      expect(all).toHaveLength(1)
      expect(all[0].txHash).toBe('hash1')
    })

    it('handles duplicate status updates idempotently', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      await repository.updateStatus('hash1', 'executed', 101)
      await repository.updateStatus('hash1', 'executed', 101)

      const all = await repository.findAll()
      expect(all[0].status).toBe('executed')
      expect(all[0].ledger).toBe(101)
    })
  })

  describe('Retrieval and ordering', () => {
    it('retrieves all transactions', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      await repository.upsert({
        txHash: 'hash2',
        target: 'target2',
        functionName: 'func2',
        args: [],
        eta: 2000,
        status: 'queued',
        ledger: 101,
      })

      const all = await repository.findAll()
      expect(all).toHaveLength(2)
    })

    it('returns transactions in reverse chronological order (newest first)', async () => {
      const tx1Promise = repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      await tx1Promise
      await new Promise(resolve => setTimeout(resolve, 5))

      await repository.upsert({
        txHash: 'hash2',
        target: 'target2',
        functionName: 'func2',
        args: [],
        eta: 2000,
        status: 'queued',
        ledger: 101,
      })

      const all = await repository.findAll()
      // Newer transaction (hash2) should come first
      expect(all[0].txHash).toBe('hash2')
      expect(all[1].txHash).toBe('hash1')
    })
  })

  describe('Consistency under concurrent operations', () => {
    it('handles concurrent upserts consistently', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        repository.upsert({
          txHash: `hash${i}`,
          target: `target${i}`,
          functionName: `func${i}`,
          args: [],
          eta: 1000 * (i + 1),
          status: 'queued',
          ledger: 100 + i,
        })
      )

      await Promise.all(promises)

      const all = await repository.findAll()
      expect(all).toHaveLength(5)
      expect(all.map(t => t.txHash).sort()).toEqual(['hash0', 'hash1', 'hash2', 'hash3', 'hash4'])
    })

    it('handles concurrent upsert + status update on same tx', async () => {
      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      // Concurrent operations
      const [, all] = await Promise.all([
        repository.updateStatus('hash1', 'executed', 101),
        repository.findAll(),
      ])

      // Should find the transaction
      expect(all.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Data format and types', () => {
    it('preserves JSON args format', async () => {
      const complexArgs = [
        { nested: 'object', value: 123 },
        ['array', 'of', 'strings'],
      ]

      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: complexArgs,
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      const all = await repository.findAll()
      expect(all[0].args).toEqual(complexArgs)
    })

    it('handles large args arrays', async () => {
      const largeArgs = Array.from({ length: 100 }, (_, i) => `arg${i}`)

      await repository.upsert({
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: largeArgs,
        eta: 1000,
        status: 'queued',
        ledger: 100,
      })

      const all = await repository.findAll()
      expect(all[0].args).toHaveLength(100)
      expect(all[0].args).toEqual(largeArgs)
    })
  })
})
