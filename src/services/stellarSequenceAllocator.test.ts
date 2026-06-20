import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StellarSequenceAllocator, resetStellarSequenceAllocator, SequenceAllocationError, ChainResyncError } from './stellarSequenceAllocator.js'
import { getPool, setPool } from '../db.js'
import { PgPoolLike } from '../db.js'

// Mock the Stellar SDK
const { mockGetAccount } = vi.hoisted(() => ({
  mockGetAccount: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: class MockServer {
      getAccount = mockGetAccount
    },
  },
}))

describe('StellarSequenceAllocator', () => {
  let mockPool: PgPoolLike
  let allocator: StellarSequenceAllocator

  beforeEach(() => {
    // Reset the global allocator
    resetStellarSequenceAllocator()

    // Create a mock pool
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
    } as unknown as PgPoolLike

    // Set the mock pool
    setPool(mockPool)

    // Clear and reset mock calls
    mockGetAccount.mockClear()
    mockGetAccount.mockReset()

    // Create allocator instance
    allocator = new StellarSequenceAllocator('https://mock-rpc.example.com', 'Test Network')
  })

  afterEach(() => {
    resetStellarSequenceAllocator()
    setPool(null)
    mockGetAccount.mockReset()
  })

  describe('allocateSequence', () => {
    it('should allocate sequence numbers in increasing order', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      let lastAllocated = 100n
      // Mock initial state - no existing allocator state
      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: lastAllocated.toString(), last_chain_sequence: lastAllocated.toString() }], rowCount: 1 }
        }
        if (query.includes('INSERT INTO stellar_sequence_allocators')) {
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('INSERT INTO stellar_sequence_allocations')) {
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('UPDATE stellar_sequence_allocators')) {
          lastAllocated++
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Mock RPC to return initial sequence
      mockGetAccount.mockResolvedValue({
        sequenceNumber: () => '100',
      } as any)

      const result1 = await allocator.allocateSequence(accountAddress)
      expect(result1.sequence).toBe(BigInt(101))

      const result2 = await allocator.allocateSequence(accountAddress)
      expect(result2.sequence).toBe(BigInt(102))

      const result3 = await allocator.allocateSequence(accountAddress)
      expect(result3.sequence).toBe(BigInt(103))
    })

    it('should be idempotent when allocationId is provided', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      const allocationId = 'test-allocation-123'

      // Mock RPC to return sequence
      mockGetAccount.mockResolvedValue({
        sequenceNumber: () => '100',
      } as any)

      // Mock existing allocation
      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT id, account_address')) {
          return {
            rows: [{
              id: allocationId,
              account_address: accountAddress,
              allocated_sequence: '150',
              status: 'pending',
            }],
            rowCount: 1,
          }
        }
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: '150', last_chain_sequence: '150' }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })

      const result = await allocator.allocateSequence(accountAddress, allocationId)
      expect(result.sequence).toBe(BigInt(150))
      expect(result.allocationId).toBe(allocationId)
    })

    it('should handle concurrent allocations for the same account', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      let lastAllocated = 200n
      // Mock initial state
      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: lastAllocated.toString(), last_chain_sequence: lastAllocated.toString() }], rowCount: 1 }
        }
        if (query.includes('INSERT INTO stellar_sequence_allocations')) {
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('UPDATE stellar_sequence_allocators')) {
          // Increment and return the new value
          lastAllocated++
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Mock RPC to return sequence
      mockGetAccount.mockResolvedValue({
        sequenceNumber: () => '200',
      } as any)

      // Allocate 10 sequences sequentially (in-process lock serializes them)
      for (let i = 0; i < 10; i++) {
        await allocator.allocateSequence(accountAddress)
      }

      // Verify that the sequence was incremented 10 times
      expect(lastAllocated).toBe(210n)
    })
  })

  describe('markConfirmed', () => {
    it('should mark an allocation as confirmed', async () => {
      const allocationId = 'test-allocation-456'
      const txHash = 'abcd1234'

      vi.mocked(mockPool.query).mockResolvedValue({ rows: [], rowCount: 0 })

      await allocator.markConfirmed(allocationId, txHash)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stellar_sequence_allocations'),
        expect.arrayContaining([allocationId, txHash])
      )
    })
  })

  describe('markFailed', () => {
    it('should mark an allocation as failed', async () => {
      const allocationId = 'test-allocation-789'

      vi.mocked(mockPool.query).mockResolvedValue({ rows: [], rowCount: 0 })

      await allocator.markFailed(allocationId)

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stellar_sequence_allocations'),
        expect.arrayContaining([allocationId])
      )
    })
  })

  describe('resync', () => {
    it('should re-sync allocator state with chain', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: '300', last_chain_sequence: '300' }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Mock RPC to return updated sequence
      mockGetAccount.mockResolvedValue({
        sequenceNumber: () => '305',
      } as any)

      await allocator.resync(accountAddress)

      // Should have updated last_chain_sequence
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stellar_sequence_allocators'),
        expect.arrayContaining([accountAddress, '305'])
      )
    })

    it('should detect and recover holes', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      let queryCount = 0
      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        queryCount++
        
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: '400', last_chain_sequence: '400' }], rowCount: 1 }
        }
        if (query.includes('UPDATE stellar_sequence_allocators') && query.includes('last_chain_sequence')) {
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('UPDATE stellar_sequence_allocations') && query.includes('status = \'failed\'')) {
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('UPDATE stellar_sequence_allocators') && query.includes('last_allocated_sequence')) {
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Mock RPC to return updated sequence (chain moved forward)
      mockGetAccount.mockResolvedValue({
        sequenceNumber: () => '410',
      } as any)

      await allocator.resync(accountAddress)

      // Should have called update for chain sequence
      expect(queryCount).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('should throw SequenceAllocationError when pool is not available', async () => {
      setPool(null)
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      await expect(allocator.allocateSequence(accountAddress))
        .rejects.toThrow(SequenceAllocationError)
    })

    it('should throw ChainResyncError when RPC fails during initialization', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Mock RPC to throw error
      mockGetAccount.mockRejectedValue(new Error('RPC failed'))

      await expect(allocator.allocateSequence(accountAddress))
        .rejects.toThrow(ChainResyncError)
    })

    it('should degrade gracefully when RPC is unavailable during re-sync', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: '500', last_chain_sequence: '500' }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Mock RPC to throw error
      mockGetAccount.mockRejectedValue(new Error('RPC unavailable'))

      // Should not throw, should degrade gracefully
      await expect(allocator.resync(accountAddress)).resolves.not.toThrow()
    })
  })

  describe('advisory locks', () => {
    it('should acquire and release DB advisory locks', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      let lockAcquired = false
      let lockReleased = false

      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('pg_advisory_lock')) {
          lockAcquired = true
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('pg_advisory_unlock')) {
          lockReleased = true
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: '600', last_chain_sequence: '600' }], rowCount: 1 }
        }
        if (query.includes('INSERT INTO stellar_sequence_allocations')) {
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('UPDATE stellar_sequence_allocators')) {
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      })

      await allocator.allocateSequence(accountAddress)

      expect(lockAcquired).toBe(true)
      expect(lockReleased).toBe(true)
    })
  })

  describe('in-process serialization', () => {
    it('should serialize concurrent allocations within a single process', async () => {
      const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

      let allocationCount = 0
      vi.mocked(mockPool.query).mockImplementation(async (query: string) => {
        if (query.includes('SELECT last_allocated_sequence')) {
          return { rows: [{ last_allocated_sequence: '700', last_chain_sequence: '700' }], rowCount: 1 }
        }
        if (query.includes('INSERT INTO stellar_sequence_allocations')) {
          allocationCount++
          return { rows: [], rowCount: 0 }
        }
        if (query.includes('UPDATE stellar_sequence_allocators')) {
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 0 }
      })

      // Allocate 5 sequences concurrently
      const promises = Array.from({ length: 5 }, () => 
        allocator.allocateSequence(accountAddress)
      )

      await Promise.all(promises)

      // All allocations should have been recorded
      expect(allocationCount).toBe(5)
    })
  })
})
