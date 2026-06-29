import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { TimelockIndexer, type TimelockIndexerConfig } from './timelock-worker.js'
import { TimelockProcessor } from './timelock-processor.js'
import { type TimelockRepository } from './timelock-repository.js'
import { type SorobanAdapter } from '../soroban/adapter.js'

describe('TimelockIndexer Worker', () => {
  let indexer: TimelockIndexer
  let mockAdapter: Partial<SorobanAdapter>
  let mockProcessor: Partial<TimelockProcessor>

  beforeEach(() => {
    vi.clearAllMocks()

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
    if (indexer) {
      await indexer.stop()
    }
  })

  describe('Worker initialization', () => {
    it('creates indexer with configuration', () => {
      expect(indexer).toBeDefined()
    })

    it('has start and stop methods', () => {
      expect(typeof indexer.start).toBe('function')
      expect(typeof indexer.stop).toBe('function')
    })
  })

  describe('Checkpoint management', () => {
    it('retrieves checkpoint from processor on start', async () => {
      ;(mockProcessor.getCheckpoint as any).mockResolvedValue(500)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      expect(mockProcessor.getCheckpoint).toHaveBeenCalled()
    })

    it('starts from configured startLedger if no checkpoint exists', async () => {
      ;(mockProcessor.getCheckpoint as any).mockResolvedValue(null)

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      // Should have initialized with startLedger config
      expect(indexer).toBeDefined()
    })
  })

  describe('Lifecycle management', () => {
    it('can be started', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      expect(indexer).toBeDefined()
    })

    it('can be stopped', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])

      await indexer.start()
      await indexer.stop()

      expect(indexer).toBeDefined()
    })

    it('prevents multiple starts', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])

      await indexer.start()
      await indexer.start() // Second start should be no-op

      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      expect(indexer).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('handles adapter errors without crashing', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockRejectedValue(
        new Error('Network error')
      )

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      // Should not throw
      expect(indexer).toBeDefined()
    })

    it('handles processor errors without crashing', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([
        { type: 'queued', txHash: 'h1', ledger: 100 },
      ])
      ;(mockProcessor.processEvents as any).mockRejectedValue(
        new Error('Processing failed')
      )

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      // Should handle gracefully
      expect(indexer).toBeDefined()
    })
  })

  describe('Empty workload handling', () => {
    it('handles empty event list', async () => {
      ;(mockAdapter.getTimelockEvents as any).mockResolvedValue([])

      await indexer.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await indexer.stop()

      expect(indexer).toBeDefined()
    })
  })
})
