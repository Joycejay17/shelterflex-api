import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSigningKeyRotationService, resetSigningKeyRotationService } from './signingKeyRotationService.js'
import { setPool, type PgPoolLike } from '../db.js'
import { Keypair } from '@stellar/stellar-sdk'

describe('SigningKeyRotationService - Crash and Resume Tests', () => {
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

  describe('Crash at new_key_provisioned state', () => {
    it('should resume from new_key_provisioned and advance to next state', async () => {
      const rotationId = 'crash-test-1'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_provisioned',
        key_type: 'admin',
        account_address: 'GCRASH1',
        old_key_id: 'old-key-crash-1',
        new_key_id: 'new-key-crash-1',
        active_key_id: 'old-key-crash-1',
        audit_log: [{ timestamp: new Date().toISOString(), event: 'new_key_provisioned', details: {} }],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }] }) // getCurrentSigners
        .mockResolvedValueOnce({ rows: [] }) // insert valid signer (new)
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'new_key_authorized_on_chain', audit_log: [] }] }) // update state

      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-1', status: 'PENDING' }),
      })

      const result = await rotationService.advanceRotation(rotationId)

      expect(result.state).toBe('new_key_authorized_on_chain')
    })
  })

  describe('Crash at new_key_authorized_on_chain state', () => {
    it('should resume from new_key_authorized_on_chain and advance to active_pointer_cutover', async () => {
      const rotationId = 'crash-test-2'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_authorized_on_chain',
        key_type: 'admin',
        account_address: 'GCRASH2',
        old_key_id: 'old-key-crash-2',
        new_key_id: 'new-key-crash-2',
        active_key_id: 'old-key-crash-2',
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'active_pointer_cutover', audit_log: [] }] }) // update state

      const result = await rotationService.advanceRotation(rotationId)

      expect(result.state).toBe('active_pointer_cutover')
    })
  })

  describe('Crash at active_pointer_cutover state', () => {
    it('should resume from active_pointer_cutover and advance to old_key_deauthorized', async () => {
      const rotationId = 'crash-test-3'
      const mockRotation = {
        id: rotationId,
        state: 'active_pointer_cutover',
        key_type: 'admin',
        account_address: 'GCRASH3',
        old_key_id: 'old-key-crash-3',
        new_key_id: 'new-key-crash-3',
        active_key_id: 'new-key-crash-3',
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'old_key_deauthorized_on_chain', audit_log: [] }] }) // update state

      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-3', status: 'PENDING' }),
      })

      const result = await rotationService.advanceRotation(rotationId)

      expect(result.state).toBe('old_key_deauthorized_on_chain')
    })
  })

  describe('Crash at old_key_deauthorized_on_chain state', () => {
    it('should resume from old_key_deauthorized and advance to old_key_destroyed', async () => {
      const rotationId = 'crash-test-4'
      const mockRotation = {
        id: rotationId,
        state: 'old_key_deauthorized_on_chain',
        key_type: 'admin',
        account_address: 'GCRASH4',
        old_key_id: 'old-key-crash-4',
        new_key_id: 'new-key-crash-4',
        active_key_id: 'new-key-crash-4',
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GNEWKEY' }] }) // getActiveSigners
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'old_key_destroyed', audit_log: [] }] }) // update state

      vi.spyOn(rotationService as any, 'rpcServer', 'get').mockReturnValue({
        getAccount: vi.fn().mockResolvedValue({
          sequenceNumber: () => '100',
        }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
        sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-4', status: 'PENDING' }),
      })

      const result = await rotationService.advanceRotation(rotationId)

      expect(result.state).toBe('old_key_destroyed')
    })
  })

  describe('Crash at old_key_destroyed state', () => {
    it('should resume from old_key_destroyed and advance to completed', async () => {
      const rotationId = 'crash-test-5'
      const mockRotation = {
        id: rotationId,
        state: 'old_key_destroyed',
        key_type: 'admin',
        account_address: 'GCRASH5',
        old_key_id: 'old-key-crash-5',
        new_key_id: 'new-key-crash-5',
        active_key_id: 'new-key-crash-5',
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'completed', audit_log: [] }] }) // update state

      const result = await rotationService.advanceRotation(rotationId)

      expect(result.state).toBe('completed')
    })
  })

  describe('Deterministic recovery', () => {
    it('should recover to same state after multiple crashes at same point', async () => {
      const rotationId = 'crash-test-deterministic'
      const mockRotation = {
        id: rotationId,
        state: 'new_key_authorized_on_chain',
        key_type: 'admin',
        account_address: 'GCRASHDET',
        old_key_id: 'old-key-det',
        new_key_id: 'new-key-det',
        active_key_id: 'old-key-det',
        audit_log: [],
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'active_pointer_cutover', audit_log: [] }] }) // update state

      // Simulate multiple recovery attempts
      const results = await Promise.all([
        rotationService.advanceRotation(rotationId),
        rotationService.advanceRotation(rotationId),
        rotationService.advanceRotation(rotationId),
      ])

      // All should result in the same next state
      results.forEach(result => {
        expect(result.state).toBe('active_pointer_cutover')
      })
    })
  })

  describe('Audit log preservation across crash', () => {
    it('should preserve audit log entries after crash and resume', async () => {
      const rotationId = 'crash-test-audit'
      const existingAuditLog = [
        { timestamp: '2024-01-01T00:00:00Z', event: 'new_key_provisioned', details: { keyId: 'new-key' } },
        { timestamp: '2024-01-01T00:01:00Z', event: 'new_key_authorized_on_chain', details: { txHash: 'tx-123' } },
      ]

      const mockRotation = {
        id: rotationId,
        state: 'new_key_authorized_on_chain',
        key_type: 'admin',
        account_address: 'GCRASHAUDIT',
        old_key_id: 'old-key-audit',
        new_key_id: 'new-key-audit',
        active_key_id: 'old-key-audit',
        audit_log: existingAuditLog,
        initiated_at: new Date(),
      }

      mockPool.query = vi.fn()
        .mockResolvedValueOnce({ rows: [mockRotation] }) // getRotation
        .mockResolvedValueOnce({ rows: [{ public_key: 'GOLDKEY' }, { public_key: 'GNEWKEY' }] }) // getActiveSigners
        .mockResolvedValueOnce({ rows: [{ id: rotationId, state: 'active_pointer_cutover', audit_log: [...existingAuditLog, { timestamp: expect.any(String), event: 'active_pointer_cutover', details: {} }] }] }) // update state

      const result = await rotationService.advanceRotation(rotationId)

      expect(result.auditLog.length).toBeGreaterThan(existingAuditLog.length)
      expect(result.auditLog.slice(0, 2)).toEqual(existingAuditLog)
    })
  })
})
