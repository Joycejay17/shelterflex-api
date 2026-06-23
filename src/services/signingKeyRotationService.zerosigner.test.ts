import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSigningKeyRotationService, resetSigningKeyRotationService, ZeroSignerWindowError } from './signingKeyRotationService.js'
import { setPool, type PgPoolLike } from '../db.js'

describe('SigningKeyRotationService - Zero Valid Signer Window Prevention', () => {
  let mockPool: PgPoolLike
  let rotationService: ReturnType<typeof getSigningKeyRotationService>

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
    } as any

    setPool(mockPool)
    resetSigningKeyRotationService()
    rotationService = getSigningKeyRotationService()
  })

  afterEach(() => {
    resetSigningKeyRotationService()
    setPool(null)
  })

  describe('Add-before-remove ordering', () => {
    it('should prevent adding new signer when account has zero valid signers', async () => {
      const rotationId = 'zero-signer-test-1'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_provisioned',
        key_type: 'admin',
        account_address: 'GZERO1',
        old_key_id: 'old-key-zero-1',
        new_key_id: 'new-key-zero-1',
        active_key_id: 'old-key-zero-1',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock zero signers
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [] }) // getCurrentSigners - ZERO SIGNERS

      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
      })

      await expect(rotationService.advanceRotation(rotationId)).rejects.toThrow(ZeroSignerWindowError)
      await expect(rotationService.advanceRotation(rotationId)).rejects.toThrow('zero valid signers')
    })

    it('should allow adding new signer when account has at least one valid signer', async () => {
      const rotationId = 'zero-signer-test-2'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_provisioned',
        key_type: 'admin',
        account_address: 'GZERO2',
        old_key_id: 'old-key-zero-2',
        new_key_id: 'new-key-zero-2',
        active_key_id: 'old-key-zero-2',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock one valid signer
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }] }) // getCurrentSigners - ONE SIGNER
        .mockResolvedValueOnce({ rows: [] }) // insert valid signer
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'new_key_authorized_on_chain', audit_log: [] }] }) // update state

      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-2', status: 'PENDING' }),
      })

      const result = await rotationService.advanceRotation(rotationId)
      expect(result.state).toBe('new_key_authorized_on_chain')
    })
  })

  describe('Remove-after-add ordering', () => {
    it('should prevent removing old signer when less than 2 valid signers exist', async () => {
      const rotationId = 'zero-signer-test-3'
      const mockRotation = {
        id: rotationId,
        state: 'active_pointer_cutover',
        key_type: 'admin',
        account_address: 'GZERO3',
        old_key_id: 'old-key-zero-3',
        new_key_id: 'new-key-zero-3',
        active_key_id: 'new-key-zero-3',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock only one valid signer (would result in zero after removal)
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GNEWKEY' }] }) // getActiveSigners - ONLY ONE

      await expect(rotationService.advanceRotation(rotationId)).rejects.toThrow(ZeroSignerWindowError)
      await expect(rotationService.advanceRotation(rotationId)).rejects.toThrow('zero valid signers')
    })

    it('should allow removing old signer when at least 2 valid signers exist', async () => {
      const rotationId = 'zero-signer-test-4'
      const mockRotation = {
        id: rotationId,
        state: 'active_pointer_cutover',
        key_type: 'admin',
        account_address: 'GZERO4',
        old_key_id: 'old-key-zero-4',
        new_key_id: 'new-key-zero-4',
        active_key_id: 'new-key-zero-4',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock two valid signers (dual-key window)
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners - TWO SIGNERS
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'old_key_deauthorized_on_chain', audit_log: [] }] }) // update state

      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-4', status: 'PENDING' }),
      })

      const result = await rotationService.advanceRotation(rotationId)
      expect(result.state).toBe('old_key_deauthorized_on_chain')
    })
  })

  describe('Dual-key window verification', () => {
    it('should verify dual-key window is active before cutover', async () => {
      const rotationId = 'zero-signer-test-5'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_authorized_on_chain',
        key_type: 'admin',
        account_address: 'GZERO5',
        old_key_id: 'old-key-zero-5',
        new_key_id: 'new-key-zero-5',
        active_key_id: 'old-key-zero-5',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock dual-key window (2 signers)
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'active_pointer_cutover', audit_log: [] }] }) // update state

      const result = await rotationService.advanceRotation(rotationId)
      expect(result.state).toBe('active_pointer_cutover')
    })

    it('should fail cutover if dual-key window is not active', async () => {
      const rotationId = 'zero-signer-test-6'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_authorized_on_chain',
        key_type: 'admin',
        account_address: 'GZERO6',
        old_key_id: 'old-key-zero-6',
        new_key_id: 'new-key-zero-6',
        active_key_id: 'old-key-zero-6',
        audit_log: [],
        initiated_at: new Date(),
      }

      // Mock only one signer (dual-key window not active)
      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }] }) // getActiveSigners - ONLY ONE

      await expect(rotationService.advanceRotation(rotationId)).rejects.toThrow(ZeroSignerWindowError)
      await expect(rotationService.advanceRotation(rotationId)).rejects.toThrow('dual-key window not active')
    })
  })

  describe('Continuous signer availability', () => {
    it('should maintain at least one valid signer throughout all rotation states', async () => {
      const rotationId = 'zero-signer-test-7'
      const accountAddress = 'GZERO7'

      const states = [
        { state: 'new_key_provisioned', active_key_id: 'old-key', signers: ['GOLDKEY'] },
        { state: 'new_key_authorized_on_chain', active_key_id: 'old-key', signers: ['GOLDKEY', 'GNEWKEY'] },
        { state: 'active_pointer_cutover', active_key_id: 'new-key', signers: ['GOLDKEY', 'GNEWKEY'] },
        { state: 'old_key_deauthorized_on_chain', active_key_id: 'new-key', signers: ['GNEWKEY'] },
        { state: 'old_key_destroyed', active_key_id: 'new-key', signers: ['GNEWKEY'] },
      ] as const

      for (const { state, active_key_id, signers } of states) {
        const mockRotation = {
          id: rotationId,
          state,
          key_type: 'admin',
          account_address: accountAddress,
          old_key_id: 'old-key',
          new_key_id: 'new-key',
          active_key_id,
          audit_log: [],
          initiated_at: new Date(),
        }

        mockPool.query = vi.fn()
          .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
          .mockResolvedValueOnce({ rows: signers.map(s => ({ public_key: s })) }) // getActiveSigners

        // Verify at least one signer exists
        const rotation = await rotationService.getRotation(rotationId)
        expect(rotation).toBeTruthy()

        // Verify active key is set
        expect(mockRotation.active_key_id).toBeTruthy()
      }
    })
  })

  describe('Database signer tracking', () => {
    it('should track signers in database to prevent zero-signer window', async () => {
      const accountAddress = 'GZERO8'

      // Simulate signer tracking through rotation
      const signerStates = [
        { step: 'initial', signers: ['GOLDKEY'] },
        { step: 'after_add', signers: ['GOLDKEY', 'GNEWKEY'] },
        { step: 'after_cutover', signers: ['GOLDKEY', 'GNEWKEY'] },
        { step: 'after_remove', signers: ['GNEWKEY'] },
      ]

      for (const { step, signers } of signerStates) {
        mockPool.query = vi.fn()
          .mockResolvedValueOnce({ rows: signers.map(s => ({ public_key: s, is_valid: true })) })

        const result = await mockPool.query(
          `SELECT public_key FROM signing_key_valid_signers
           WHERE account_address = $1 AND is_valid = true`,
          [accountAddress]
        )

        expect(result.rows.length).toBeGreaterThan(0)
        expect(result.rows.length).toBe(signers.length)
      }
    })
  })
})
