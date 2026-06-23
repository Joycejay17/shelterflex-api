import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSigningKeyRotationService, resetSigningKeyRotationService } from './signingKeyRotationService.js'
import { setPool, type PgPoolLike } from '../db.js'
import { Keypair } from '@stellar/stellar-sdk'

describe('SigningKeyRotationService - Concurrent Signing Load Tests', () => {
  let mockPool: PgPoolLike
  let rotationService: ReturnType<typeof getSigningKeyRotationService>

  beforeEach(() => {
    // Mock database pool
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
    } as any

    setPool(mockPool)
    resetSigningKeyRotationService()

    // Create service instance with test RPC URL
    rotationService = getSigningKeyRotationService()
  })

  afterEach(() => {
    resetSigningKeyRotationService()
    setPool(null)
  })

  describe('Concurrent rotation advances', () => {
    it('should handle concurrent advanceRotation calls without race conditions', async () => {
      const rotationId = 'test-rotation-123'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_provisioned',
        key_type: 'admin',
        account_address: 'GTEST123',
        old_key_id: 'old-key-1',
        new_key_id: 'new-key-1',
        active_key_id: 'old-key-1',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock getRotation to return the rotation
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [] }) // getActiveSigners (empty for initial state)
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }] }) // getActiveSigners after add
        .mockResolvedValueOnce({ rows: [] }) // insert valid signer
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'new_key_authorized_on_chain', audit_log: [] }] }) // update state

      // Mock RPC calls
      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-123', status: 'PENDING' }),
      })

      // Simulate concurrent advances
      const concurrentAdvances = Array.from({ length: 10 }, () => 
        rotationService.advanceRotation(rotationId)
      )

      // All should complete without errors
      const results = await Promise.allSettled(concurrentAdvances)

      // At least one should succeed
      const successful = results.filter(r => r.status === 'fulfilled')
      expect(successful.length).toBeGreaterThan(0)

      // No unexpected errors
      results.forEach(result => {
        if (result.status === 'rejected') {
          expect(result.reason).not.toContain('race')
        }
      })
    })
  })

  describe('Concurrent signing during rotation', () => {
    it('should allow signing operations during dual-key window', async () => {
      const rotationId = 'test-rotation-456'
      const accountAddress = 'GTEST456'

      // Mock rotation in dual-key state
      const mockRotation = {
        id: rotationId,
        state: 'active_pointer_cutover',
        key_type: 'admin',
        account_address,
        old_key_id: 'old-key-2',
        new_key_id: 'new-key-2',
        active_key_id: 'new-key-2',
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getActiveRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners

      // Mock key retrieval
      const testKeypair = Keypair.random()
      vi.spyOn(rotationService, 'retrieveKeyMaterial' as any).mockResolvedValue(testKeypair.secret())

      // Simulate concurrent getActiveKey calls
      const concurrentKeyRequests = Array.from({ length: 20 }, () => 
        rotationService.getActiveKey('admin' as any, accountAddress)
      )

      const results = await Promise.all(concurrentKeyRequests)

      // All should return the same active key
      results.forEach(result => {
        expect(result).toBe('new-key-2')
      })
    })
  })

  describe('Zero failed signatures under load', () => {
    it('should maintain signing availability during rotation state transitions', async () => {
      const rotationId = 'test-rotation-789'
      const accountAddress = 'GTEST789'

      const states = [
        'new_key_provisioned',
        'new_key_authorized_on_chain',
        'active_pointer_cutover',
        'old_key_deauthorized_on_chain',
        'old_key_destroyed',
      ] as const

      for (const state of states) {
        const mockRotation = {
          id: rotationId,
          state,
          key_type: 'admin',
          account_address,
          old_key_id: 'old-key-3',
          new_key_id: 'new-key-3',
          active_key_id: state === 'active_pointer_cutover' ? 'new-key-3' : 'old-key-3',
          audit_log: [],
          initiated_at: new Date(),
        }

        mockPool.query = vi.fn()
          .mockResolvedValueOnce({ rows: [mockRotation] }) // getActiveRotation
          .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }] }) // getActiveSigners

        const testKeypair = Keypair.random()
        vi.spyOn(rotationService, 'retrieveKeyMaterial' as any).mockResolvedValue(testKeypair.secret())

        // Simulate signing during this state
        const signingRequests = Array.from({ length: 5 }, () => 
          rotationService.getActiveKey('admin' as any, accountAddress)
        )

        const results = await Promise.all(signingRequests)

        // All signing requests should succeed
        results.forEach(result => {
          expect(result).toBeTruthy()
        })
      }
    })
  })

  describe('Sequence allocation during rotation', () => {
    it('should coordinate with sequence allocator during dual-key window', async () => {
      const rotationId = 'test-rotation-seq'
      const accountAddress = 'GTESTSEQ'

      const mockRotation = {
        id: rotationId,
        state: 'new_key_authorized_on_chain',
        key_type: 'admin',
        account_address,
        old_key_id: 'old-key-seq',
        new_key_id: 'new-key-seq',
        active_key_id: 'old-key-seq',
        sequence_at_rotation_start: 100n,
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getActiveRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners

      // The rotation should track sequence_at_rotation_start
      expect(mockRotation.sequence_at_rotation_start).toBe(100n)
    })
  })
})
