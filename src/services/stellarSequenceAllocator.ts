import { getPool, type PgPoolLike } from '../db.js'
import { rpc } from '@stellar/stellar-sdk'
import { logger } from '../utils/logger.js'

/**
 * Error thrown when sequence allocation fails
 */
export class SequenceAllocationError extends Error {
  constructor(message: string, public readonly accountAddress: string) {
    super(message)
    this.name = 'SequenceAllocationError'
  }
}

/**
 * Error thrown when chain re-sync fails
 */
export class ChainResyncError extends Error {
  constructor(message: string, public readonly accountAddress: string) {
    super(message)
    this.name = 'ChainResyncError'
  }
}

/**
 * Allocation result with the allocated sequence number
 */
export interface AllocationResult {
  sequence: bigint
  allocationId: string
}

/**
 * Sequence allocator for Stellar/Soroban transactions
 * 
 * This service coordinates sequence number allocation across concurrent requests
 * and multiple backend instances to prevent tx_bad_seq errors.
 * 
 * Architecture:
 * - In-process: Mutex per account for single-instance serialization
 * - Multi-instance: PostgreSQL advisory locks for cross-instance coordination
 * - Persistence: Database table tracks last allocated and chain sequences
 * - Recovery: Chain re-sync detects and recovers from holes
 */
export class StellarSequenceAllocator {
  private readonly inProcessLocks = new Map<string, Promise<void>>()
  private readonly rpcServer: rpc.Server
  private readonly networkPassphrase: string

  constructor(rpcUrl: string, networkPassphrase: string) {
    this.rpcServer = new rpc.Server(rpcUrl)
    this.networkPassphrase = networkPassphrase
  }

  /**
   * Allocate the next sequence number for an account
   * 
   * This method is idempotent - if called multiple times with the same
   * allocationId, it will return the same sequence number.
   * 
   * @param accountAddress - Stellar account address
   * @param allocationId - Unique identifier for this allocation (for idempotency)
   * @returns The allocated sequence number
   */
  async allocateSequence(
    accountAddress: string,
    allocationId?: string
  ): Promise<AllocationResult> {
    // Acquire in-process lock for this account
    const releaseLock = await this.acquireInProcessLock(accountAddress)
    
    try {
      // Acquire DB advisory lock for multi-instance coordination
      const releaseDbLock = await this.acquireDbAdvisoryLock(accountAddress)
      
      try {
        // Ensure allocator state is synced with chain
        await this.ensureSynced(accountAddress)
        
        // Get current allocation state
        const state = await this.getAllocationState(accountAddress)
        
        // If allocationId provided, check if this is a retry
        if (allocationId) {
          const existing = await this.getExistingAllocation(allocationId)
          if (existing) {
            logger.info('Sequence allocation retry - reusing existing sequence', {
              accountAddress,
              allocationId,
              sequence: existing.allocated_sequence.toString(),
            })
            return {
              sequence: BigInt(existing.allocated_sequence),
              allocationId,
            }
          }
        }
        
        // Allocate next sequence
        const nextSequence = state.last_allocated_sequence + BigInt(1)
        const newAllocationId = allocationId || this.generateAllocationId()
        
        // Record the allocation
        await this.recordAllocation(accountAddress, nextSequence, newAllocationId)
        
        // Update last allocated sequence
        await this.updateLastAllocated(accountAddress, nextSequence)
        
        logger.info('Sequence allocated', {
          accountAddress,
          sequence: nextSequence.toString(),
          allocationId: newAllocationId,
        })
        
        return {
          sequence: nextSequence,
          allocationId: newAllocationId,
        }
      } finally {
        await releaseDbLock()
      }
    } finally {
      releaseLock()
    }
  }

  /**
   * Mark an allocation as confirmed (transaction successfully submitted)
   * 
   * @param allocationId - The allocation ID to mark as confirmed
   * @param txHash - Optional transaction hash
   */
  async markConfirmed(allocationId: string, txHash?: string): Promise<void> {
    const pool = await this.getPool()
    await pool.query(
      `UPDATE stellar_sequence_allocations 
       SET status = 'confirmed', confirmed_at = NOW(), transaction_hash = $2
       WHERE id = $1`,
      [allocationId, txHash || null]
    )
    
    logger.info('Sequence allocation marked as confirmed', {
      allocationId,
      txHash,
    })
  }

  /**
   * Mark an allocation as failed (transaction submission failed)
   * This allows the sequence to be reclaimed during re-sync
   * 
   * @param allocationId - The allocation ID to mark as failed
   */
  async markFailed(allocationId: string): Promise<void> {
    const pool = await this.getPool()
    await pool.query(
      `UPDATE stellar_sequence_allocations 
       SET status = 'failed' 
       WHERE id = $1`,
      [allocationId]
    )
    
    logger.info('Sequence allocation marked as failed', { allocationId })
  }

  /**
   * Re-sync the allocator state with the actual chain state
   * This detects holes and recovers sequence numbers
   * 
   * @param accountAddress - Stellar account address
   */
  async resync(accountAddress: string): Promise<void> {
    const releaseLock = await this.acquireInProcessLock(accountAddress)
    
    try {
      const releaseDbLock = await this.acquireDbAdvisoryLock(accountAddress)
      
      try {
        await this.ensureSynced(accountAddress)
        logger.info('Sequence allocator re-synced', { accountAddress })
      } finally {
        await releaseDbLock()
      }
    } finally {
      releaseLock()
    }
  }

  /**
   * Ensure the allocator state is synced with the chain
   * Detects holes and updates last_chain_sequence
   */
  private async ensureSynced(accountAddress: string): Promise<void> {
    try {
      // Fetch current sequence from chain
      const accountResponse = await this.rpcServer.getAccount(accountAddress)
      const chainSequence = BigInt(accountResponse.sequenceNumber())
      
      // Get current allocator state
      const state = await this.getAllocationState(accountAddress)
      
      // If chain sequence is ahead of our last allocated, we missed some transactions
      if (chainSequence > state.last_chain_sequence) {
        logger.info('Chain sequence advanced - updating allocator state', {
          accountAddress,
          previousChainSequence: state.last_chain_sequence.toString(),
          newChainSequence: chainSequence.toString(),
        })
        
        await this.updateLastChainSequence(accountAddress, chainSequence)
        
        // Detect and recover holes
        await this.recoverHoles(accountAddress, chainSequence)
      }
      
      // If our last allocated is ahead of chain, we have pending allocations
      // This is normal - transactions may be in flight
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to sync with chain', {
        accountAddress,
        error: message,
      })
      // Don't throw - degrade gracefully if RPC is unavailable
      // The allocator will continue to work but may have stale chain state
    }
  }

  /**
   * Detect and recover holes in the sequence allocation
   * 
   * A hole occurs when:
   * - An allocation was made but the transaction failed
   * - The chain sequence advanced past our last allocated
   * 
   * We recover by:
   * - Finding pending allocations older than a threshold
   * - Marking them as failed
   * - Updating last_allocated_sequence to match chain
   */
  private async recoverHoles(accountAddress: string, chainSequence: bigint): Promise<void> {
    const pool = await this.getPool()
    
    // Find pending allocations that are likely failed (older than 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const { rows } = await pool.query(
      `UPDATE stellar_sequence_allocations
       SET status = 'failed'
       WHERE account_address = $1
         AND status = 'pending'
         AND created_at < $2
       RETURNING id, allocated_sequence`,
      [accountAddress, fiveMinutesAgo]
    )
    
    if (rows.length > 0) {
      logger.info('Recovered failed sequence allocations', {
        accountAddress,
        count: rows.length,
        allocations: rows.map((r: any) => ({
          id: r.id,
          sequence: r.allocated_sequence.toString(),
        })),
      })
    }
    
    // Update last_allocated to match chain if chain is ahead
    const state = await this.getAllocationState(accountAddress)
    if (chainSequence > state.last_allocated_sequence) {
      await this.updateLastAllocated(accountAddress, chainSequence)
    }
  }

  /**
   * Get the current allocation state for an account
   */
  private async getAllocationState(accountAddress: string): Promise<{
    last_allocated_sequence: bigint
    last_chain_sequence: bigint
  }> {
    const pool = await this.getPool()
    
    const { rows } = await pool.query(
      `SELECT last_allocated_sequence, last_chain_sequence
       FROM stellar_sequence_allocators
       WHERE account_address = $1`,
      [accountAddress]
    )
    
    if (rows.length === 0) {
      // First time allocating for this account - initialize from chain
      try {
        const account = await this.rpcServer.getAccount(accountAddress)
        const chainSequence = BigInt(account.sequenceNumber())
        
        await pool.query(
          `INSERT INTO stellar_sequence_allocators (account_address, last_allocated_sequence, last_chain_sequence)
           VALUES ($1, $2, $3)`,
          [accountAddress, chainSequence, chainSequence]
        )
        
        return {
          last_allocated_sequence: chainSequence,
          last_chain_sequence: chainSequence,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new ChainResyncError(
          `Failed to initialize allocator for account ${accountAddress}: ${message}`,
          accountAddress
        )
      }
    }
    
    const row = rows[0]
    return {
      last_allocated_sequence: BigInt(row.last_allocated_sequence),
      last_chain_sequence: BigInt(row.last_chain_sequence),
    }
  }

  /**
   * Get an existing allocation by ID
   */
  private async getExistingAllocation(allocationId: string): Promise<{
    id: string
    account_address: string
    allocated_sequence: bigint
    status: string
  } | null> {
    const pool = await this.getPool()
    
    const { rows } = await pool.query(
      `SELECT id, account_address, allocated_sequence, status
       FROM stellar_sequence_allocations
       WHERE id = $1`,
      [allocationId]
    )
    
    if (rows.length === 0) return null
    
    const row = rows[0]
    return {
      id: row.id,
      account_address: row.account_address,
      allocated_sequence: BigInt(row.allocated_sequence),
      status: row.status,
    }
  }

  /**
   * Record a new sequence allocation
   */
  private async recordAllocation(
    accountAddress: string,
    sequence: bigint,
    allocationId: string
  ): Promise<void> {
    const pool = await this.getPool()
    
    await pool.query(
      `INSERT INTO stellar_sequence_allocations (account_address, allocated_sequence, id)
       VALUES ($1, $2, $3)`,
      [accountAddress, sequence.toString(), allocationId]
    )
  }

  /**
   * Update the last allocated sequence for an account
   */
  private async updateLastAllocated(accountAddress: string, sequence: bigint): Promise<void> {
    const pool = await this.getPool()
    
    await pool.query(
      `UPDATE stellar_sequence_allocators
       SET last_allocated_sequence = $2, updated_at = NOW()
       WHERE account_address = $1`,
      [accountAddress, sequence.toString()]
    )
  }

  /**
   * Update the last chain sequence for an account
   */
  private async updateLastChainSequence(accountAddress: string, sequence: bigint): Promise<void> {
    const pool = await this.getPool()
    
    await pool.query(
      `UPDATE stellar_sequence_allocators
       SET last_chain_sequence = $2, updated_at = NOW()
       WHERE account_address = $1`,
      [accountAddress, sequence.toString()]
    )
  }

  /**
   * Acquire an in-process mutex lock for an account
   * This serializes allocation within a single process
   */
  private async acquireInProcessLock(accountAddress: string): Promise<() => void> {
    // Wait for existing lock if present
    let existingLock = this.inProcessLocks.get(accountAddress)
    if (existingLock) {
      await existingLock
    }
    
    // Create new lock
    let resolveLock: () => void = () => {}
    const lockPromise = new Promise<void>(resolve => {
      resolveLock = resolve
    })
    
    this.inProcessLocks.set(accountAddress, lockPromise)
    
    // Return release function
    return () => {
      resolveLock()
      this.inProcessLocks.delete(accountAddress)
    }
  }

  /**
   * Acquire a PostgreSQL advisory lock for an account
   * This serializes allocation across multiple backend instances
   */
  private async acquireDbAdvisoryLock(accountAddress: string): Promise<() => void> {
    const pool = await this.getPool()
    
    // Use hash of account address as advisory lock key
    const lockKey = this.hashAdvisoryLockKey(accountAddress)
    
    try {
      await pool.query('SELECT pg_advisory_lock($1)', [lockKey])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SequenceAllocationError(
        `Failed to acquire DB advisory lock for account ${accountAddress}: ${message}`,
        accountAddress
      )
    }
    
    // Return release function
    return async () => {
      try {
        await pool.query('SELECT pg_advisory_unlock($1)', [lockKey])
      } catch (error) {
        // Log but don't throw - lock will eventually be released by session end
        logger.error('Failed to release DB advisory lock', {
          accountAddress,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  /**
   * Generate a consistent advisory lock key from account address
   * Uses a simple hash function to convert address to a number
   */
  private hashAdvisoryLockKey(accountAddress: string): number {
    let hash = 0
    for (let i = 0; i < accountAddress.length; i++) {
      const char = accountAddress.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Generate a unique allocation ID
   */
  private generateAllocationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Get the database pool
   */
  private async getPool(): Promise<PgPoolLike> {
    const pool = await getPool()
    if (!pool) {
      throw new SequenceAllocationError(
        'Database pool is not available',
        'unknown'
      )
    }
    return pool
  }
}

// Global singleton instance
let globalAllocator: StellarSequenceAllocator | null = null

/**
 * Get or create the global sequence allocator instance
 */
export function getStellarSequenceAllocator(): StellarSequenceAllocator {
  if (!globalAllocator) {
    const rpcUrl = process.env.SOROBAN_RPC_URL || ''
    const networkPassphrase = process.env.SOROBAN_NETWORK_PASSPHRASE || 'Public Global Stellar Network ; September 2015'
    
    if (!rpcUrl) {
      throw new Error('SOROBAN_RPC_URL environment variable is required for sequence allocator')
    }
    
    globalAllocator = new StellarSequenceAllocator(rpcUrl, networkPassphrase)
  }
  
  return globalAllocator
}

/**
 * Reset the global allocator (mainly for testing)
 */
export function resetStellarSequenceAllocator(): void {
  globalAllocator = null
}
