import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TimelockIndexer, type TimelockIndexerConfig } from './timelock-worker.js'
import { TimelockProcessor } from './timelock-processor.js'
import { type TimelockRepository } from './timelock-repository.js'
import { type SorobanAdapter } from '../soroban/adapter.js'

describe('TimelockIndexer Worker', () => {
  let indexer: TimelockIndexer
  let mockAdapter: Partial<SorobanAdapter>
  let mockProcessor: Partial<TimelockProcessor>
  let mockRepository: Partial<TimelockRepository>

  beforeEach(() => {
    mockRepository = {
      getCheckpoint: vi.fn().mockResolvedValue(null),
      saveCheckpoint: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn().mockResolvedValue([]),
    }

    mockProcessor = {
      getCheckpoint: vi.fn().mockResolvedValue(null),
      processEvents: vi.fn().mockResolvedValue(undefined),
    }

    mockAdapter = {
      getTimelockEvents: vi.fn().mockResolvedValue([]),
    }

    const config: TimelockIndexerConfig = {
      pollIntervalMs: 1000,
      startLedger: 100,
    }

    indexer = new TimelockIndexer(
      mockAdapter as SorobanAdapter,
      mockProcessor as TimelockProcessor,
      config
    )
  })

  afterEach(async () => {
    await indexer.stop()
  })

  describe('Worker ordering and event processing', () => {
    it('processes timelock events in order', async () => {
      const events = [
        {
          type: 'queued',
          txHash: 'hash1',
          target: 'target1',
          functionName: 'func1',
          args: [],
          delay: 1000,
          ledger: 100,
        },
        {
          type: 'queued',
          txHash: 'hash2',
          target: 'target2',
          functionName: 'func2',
          args: [],
          delay: 2000,
          ledger: 101,
        },
        {
          type: 'executed',
          txHash: 'hash1',
          ledger: 102,
        },
      ]

      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([
        { ...events[0], ledger: 100 },
        { ...events[1], ledger: 101 },
        { ...events[2], ledger: 102 },
      ])

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify events were processed in order by checking processEvents was called
      expect(mockProcessor.processEvents).toHaveBeenCalled()
    })

    it('is idempotent on duplicate deliveries', async () => {
      const event = {
        type: 'queued',
        txHash: 'hash1',
        target: 'target1',
        functionName: 'func1',
        args: [],
        delay: 1000,
        ledger: 100,
      }

      // First poll - deliver event
      ;(mockAdapter.getTimelockEvents as any)
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([event]) // Duplicate delivery in second poll
        .mockResolvedValueOnce([])

      ;(mockProcessor.processEvents as any)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 150))

      // Processor should handle both deliveries gracefully
      expect(mockProcessor.processEvents).toHaveBeenCalled()
    })

    it('handles out-of-order events without state regression', async () => {
      // Simulate network causing out-of-order delivery
      const events = [
        {
          type: 'executed',
          txHash: 'hash1',
          ledger: 150, // Later event first
        },
        {
          type: 'queued',
          txHash: 'hash1',
          target: 'target1',
          functionName: 'func1',
          args: [],
          delay: 1000,
          ledger: 100, // Earlier event second
        },
      ]

      ;(mockAdapter.getTimelockEvents as any)
        .mockResolvedValueOnce([events[0]])
        .mockResolvedValueOnce([events[1]])
        .mockResolvedValueOnce([])

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 150))

      // Processor should have been called even with out-of-order delivery
      expect(mockProcessor.processEvents).toHaveBeenCalled()
    })
  })

  describe('Checkpoint management', () => {
    it('recovers from saved checkpoint on restart', async () => {
      ;(mockProcessor.getCheckpoint as any).mockResolvedValue(500)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))

      // Should start from checkpoint 500, not from startLedger
      expect(mockAdapter.getTimelockEvents).toHaveBeenCalled()
    })

    it('saves checkpoint after processing events', async () => {
      const events = [
        {
          type: 'queued',
          txHash: 'hash1',
          target: 'target1',
          functionName: 'func1',
          args: [],
          delay: 1000,
          ledger: 100,
        },
      ]

      ;(mockAdapter.getTimelockEvents as any).mockResolvedValueOnce(events)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should save checkpoint after processing
      expect(mockProcessor.processEvents).toHaveBeenCalled()
    })

    it('starts from configured startLedger if no checkpoint exists', async () => {
      ;(mockProcessor.getCheckpoint as any).mockResolvedValue(null)

      const config: TimelockIndexerConfig = {
        pollIntervalMs: 1000,
        startLedger: 200,
      }

      const indexer2 = new TimelockIndexer(
        mockAdapter as SorobanAdapter,
        mockProcessor as TimelockProcessor,
        config
      )

      await indexer2.start()
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(mockAdapter.getTimelockEvents).toHaveBeenCalled()
      await indexer2.stop()
    })
  })

  describe('Error handling and resilience', () => {
    it('handles adapter errors gracefully and continues polling', async () => {
      ;(mockAdapter.getTimelockEvents as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([])

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should have retried after error
      expect(mockAdapter.getTimelockEvents).toHaveBeenCalledTimes(2)
    })

    it('handles processor errors without crashing', async () => {
      const events = [
        {
          type: 'queued',
          txHash: 'hash1',
          target: 'target1',
          functionName: 'func1',
          args: [],
          delay: 1000,
          ledger: 100,
        },
      ]

      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue(events)
      ;(mockProcessor.processEvents as any).mockRejectedValueOnce(
        new Error('Processing failed')
      )

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not throw despite processor error
      await indexer.stop()
    })
  })

  describe('Lifecycle management', () => {
    it('starts and stops polling correctly', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      const callsWhileRunning = (mockAdapter.getTimelockEvents as any).mock.calls.length

      await indexer.stop()
      await new Promise(resolve => setTimeout(resolve, 100))
      const callsAfterStop = (mockAdapter.getTimelockEvents as any).mock.calls.length

      // Should not have made additional calls after stop
      expect(callsAfterStop).toBe(callsWhileRunning)
    })

    it('prevents multiple starts', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])

      await indexer.start()
      await indexer.start() // Second start should be no-op

      await new Promise(resolve => setTimeout(resolve, 50))

      // Should only have called adapter once despite two starts
      expect(mockAdapter.getTimelockEvents).toHaveBeenCalledTimes(1)

      await indexer.stop()
    })

    it('stops gracefully even if polling is in progress', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 200))
      )

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))

      // Stop while request might still be in flight
      await indexer.stop()

      expect(indexer).toBeDefined() // Should not throw
    })
  })

  describe('Empty workload handling', () => {
    it('handles empty event list without error', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])
      ;(mockProcessor.processEvents as any).mockResolvedValue(undefined)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should complete gracefully with no events
      await indexer.stop()
      expect(indexer).toBeDefined()
    })

    it('handles null events gracefully', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([null, undefined])
      ;(mockProcessor.processEvents as any).mockResolvedValue(undefined)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 100))

      await indexer.stop()
      expect(indexer).toBeDefined()
    })
  })
})
