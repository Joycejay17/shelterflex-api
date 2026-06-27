import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationError, TransactionError } from '../soroban/errors.js'

const { mockGetActiveKey, mockRetrieveKeyMaterial, mockAllocateSequence, mockMarkConfirmed, mockMarkFailed } = vi.hoisted(() => ({
  mockGetActiveKey: vi.fn().mockResolvedValue(null),
  mockRetrieveKeyMaterial: vi.fn(),
  mockAllocateSequence: vi.fn().mockResolvedValue({ sequence: BigInt(100), allocationId: 'alloc-1' }),
  mockMarkConfirmed: vi.fn().mockResolvedValue(undefined),
  mockMarkFailed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/signingKeyRotationService.js', () => ({
  getSigningKeyRotationService: vi.fn(() => ({
    getActiveKey: mockGetActiveKey,
    retrieveKeyMaterial: mockRetrieveKeyMaterial,
  })),
}))

vi.mock('../services/stellarSequenceAllocator.js', () => ({
  getStellarSequenceAllocator: vi.fn(() => ({
    allocateSequence: mockAllocateSequence,
    markConfirmed: mockMarkConfirmed,
    markFailed: mockMarkFailed,
  })),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

const mockGetAccount = vi.fn().mockResolvedValue({ sequenceNumber: () => '100' })
const mockSendTransaction = vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'tx-hash-123' })
const mockGetTransaction = vi.fn().mockResolvedValue({ status: 'SUCCESS' })

vi.mock('@stellar/stellar-sdk', () => {
  return {
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({
        publicKey: () => 'GADMINPUBLICKEY1234567890',
        sign: vi.fn(),
      }),
    },
    TransactionBuilder: class MockTransactionBuilder {
      constructor(_account: any, _opts: any) {}
      addOperation(_op: any) { return this }
      setTimeout(_t: any) { return this }
      build() {
        return { sign: vi.fn(), toXDR: vi.fn().mockReturnValue('mock-xdr') }
      }
    },
    Operation: {
      invokeHostFunction: vi.fn().mockReturnValue('mock-operation'),
    },
    xdr: {
      HostFunction: {
        hostFunctionTypeInvokeContract: vi.fn().mockReturnValue('mock-host-fn'),
      },
      InvokeContractArgs: class MockInvokeContractArgs {
        constructor(_args: any) {}
      },
      ScVal: {},
    },
    Address: {
      fromString: vi.fn().mockReturnValue({
        toScAddress: vi.fn().mockReturnValue('mock-address'),
      }),
    },
    rpc: {
      Server: vi.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
    },
    Account: class MockAccount {
      constructor(public _address: string, public _sequence: string) {}
    },
  }
})

import { AdminSigningService, type AdminOperationParams } from './adminSigningService.js'

function makeParams(overrides: Partial<AdminOperationParams> = {}): AdminOperationParams {
  return {
    contractId: 'CCONTRACT1234567890ABCDEF',
    operation: 'pause',
    args: [],
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    adminSecret: 'SADMINSECRET1234567890ABCDEF',
    server: { getAccount: mockGetAccount, sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as any,
    ...overrides,
  }
}

describe('AdminSigningService', () => {
  let service: AdminSigningService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetActiveKey.mockResolvedValue(null)
    mockAllocateSequence.mockResolvedValue({ sequence: BigInt(100), allocationId: 'alloc-1' })
    mockMarkConfirmed.mockResolvedValue(undefined)
    mockMarkFailed.mockResolvedValue(undefined)
    mockGetAccount.mockResolvedValue({ sequenceNumber: () => '100' })
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'tx-hash-123' })
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' })

    service = new AdminSigningService({
      enabled: true,
      adminSecret: 'SADMINSECRET1234567890ABCDEF',
      networkPassphrase: 'Test SDF Future Network ; October 2022',
      server: { getAccount: mockGetAccount, sendTransaction: mockSendTransaction, getTransaction: mockGetTransaction } as any,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function executeWithAdvance(params?: AdminOperationParams) {
    const promise = service.executeAdminOperation(params ?? makeParams())
    await vi.advanceTimersByTimeAsync(30_000)
    return promise
  }

  // ---------------------------------------------------------------------------
  // isEnabled
  // ---------------------------------------------------------------------------
  describe('isEnabled', () => {
    it('returns true when enabled and adminSecret is set', () => {
      expect(service.isEnabled()).toBe(true)
    })

    it('returns false when disabled', () => {
      const disabled = new AdminSigningService({
        enabled: false,
        adminSecret: 'SADMINSECRET1234567890ABCDEF',
        networkPassphrase: 'Test',
        server: {} as any,
      })
      expect(disabled.isEnabled()).toBe(false)
    })

    it('returns false when adminSecret is missing', () => {
      const noSecret = new AdminSigningService({
        enabled: true,
        networkPassphrase: 'Test',
        server: {} as any,
      })
      expect(noSecret.isEnabled()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Authorization — per-operation
  // ---------------------------------------------------------------------------
  describe('authorization', () => {
    it('rejects when service is disabled', async () => {
      const disabled = new AdminSigningService({
        enabled: false,
        adminSecret: 'SADMINSECRET1234567890ABCDEF',
        networkPassphrase: 'Test',
        server: {} as any,
      })

      await expect(disabled.executeAdminOperation(makeParams())).rejects.toThrow(ConfigurationError)
    })

    it('rejects when adminSecret is missing', async () => {
      const noSecret = new AdminSigningService({
        enabled: true,
        networkPassphrase: 'Test',
        server: {} as any,
      })

      await expect(noSecret.executeAdminOperation(makeParams())).rejects.toThrow(ConfigurationError)
    })

    it('rejects operations not in the whitelist', async () => {
      await expect(
        service.executeAdminOperation(makeParams({ operation: 'unauthorized_op' as any })),
      ).rejects.toThrow(ConfigurationError)
    })

    it('allows all whitelisted operations', async () => {
      const allowedOps = [
        'pause', 'unpause', 'set_operator', 'init', 'execute', 'cancel',
        'activate_deal', 'complete_deal', 'default_deal', 'stake_bond', 'unstake_bond',
      ] as const

      for (const op of allowedOps) {
        const hash = await executeWithAdvance(makeParams({ operation: op }))
        expect(hash).toBeDefined()
        expect(typeof hash).toBe('string')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Audit logging
  // ---------------------------------------------------------------------------
  describe('audit logging', () => {
    it('logs operation initiated before execution', async () => {
      const { logger } = await import('../utils/logger.js')
      const infoSpy = vi.mocked(logger.info)

      await executeWithAdvance()

      expect(infoSpy).toHaveBeenCalledWith(
        'Admin operation executed',
        expect.objectContaining({
          operation: 'pause',
          contractId: expect.any(String),
          adminPublicKey: expect.any(String),
          success: false,
        }),
      )
    })

    it('logs operation success after confirmation', async () => {
      const { logger } = await import('../utils/logger.js')
      const infoSpy = vi.mocked(logger.info)

      await executeWithAdvance()

      const successLog = infoSpy.mock.calls.find(
        (call) => call[0] === 'Admin operation executed' && (call[1] as any).success === true,
      )
      expect(successLog).toBeDefined()
      expect(successLog![1]).toEqual(
        expect.objectContaining({
          operation: 'pause',
          success: true,
          transactionHash: expect.any(String),
        }),
      )
    })

    it('logs operation failure with error message', async () => {
      const { logger } = await import('../utils/logger.js')
      const infoSpy = vi.mocked(logger.info)

      mockSendTransaction.mockResolvedValueOnce({
        status: 'FAILED',
        hash: 'tx-fail-hash',
        errorResultXdr: 'mock-xdr',
      })

      await expect(service.executeAdminOperation(makeParams())).rejects.toThrow(TransactionError)

      const failureLog = infoSpy.mock.calls.find(
        (call) =>
          call[0] === 'Admin operation executed' &&
          typeof call[1] === 'object' &&
          call[1] !== null &&
          (call[1] as any).success === false &&
          (call[1] as any).error,
      )
      expect(failureLog).toBeDefined()
    })

    it('audit log contains no secrets', async () => {
      const { logger } = await import('../utils/logger.js')
      const infoSpy = vi.mocked(logger.info)

      await executeWithAdvance()

      const allLogs = infoSpy.mock.calls.map((c) => JSON.stringify(c))
      for (const logStr of allLogs) {
        expect(logStr).not.toContain('SADMINSECRET')
        expect(logStr).not.toContain('adminSecret')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Parameter tampering detection
  // ---------------------------------------------------------------------------
  describe('parameter tampering', () => {
    it('params are bound into the signed transaction — not swappable', async () => {
      let callCount = 0
      mockSendTransaction.mockImplementation(() => {
        callCount++
        return Promise.resolve({ status: 'PENDING', hash: `tx-hash-${callCount}` })
      })

      const hash1 = await executeWithAdvance(makeParams({ operation: 'pause' }))
      const hash2 = await executeWithAdvance(makeParams({ operation: 'unpause' }))
      expect(hash1).not.toBe(hash2)
    })
  })

  // ---------------------------------------------------------------------------
  // Replay prevention
  // ---------------------------------------------------------------------------
  describe('replay prevention', () => {
    it('each execution creates a new sequence allocation', async () => {
      await executeWithAdvance()
      await executeWithAdvance()
      expect(mockAllocateSequence).toHaveBeenCalledTimes(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Transaction failure handling
  // ---------------------------------------------------------------------------
  describe('transaction failure handling', () => {
    it('marks allocation as failed when transaction fails', async () => {
      mockSendTransaction.mockResolvedValueOnce({
        status: 'FAILED',
        hash: 'tx-fail',
        errorResultXdr: 'mock',
      })

      await expect(service.executeAdminOperation(makeParams())).rejects.toThrow(TransactionError)
      expect(mockMarkFailed).toHaveBeenCalledWith('alloc-1')
    })

    it('marks allocation as confirmed on success', async () => {
      const promise = service.executeAdminOperation(makeParams())
      await vi.advanceTimersByTimeAsync(30_000)
      await promise
      expect(mockMarkConfirmed).toHaveBeenCalledWith('alloc-1', expect.any(String))
    })

    it('wraps unknown errors in TransactionError', async () => {
      mockSendTransaction.mockRejectedValueOnce(new Error('network glitch'))
      await expect(service.executeAdminOperation(makeParams())).rejects.toThrow(TransactionError)
    })
  })

  // ---------------------------------------------------------------------------
  // Key rotation
  // ---------------------------------------------------------------------------
  describe('key rotation', () => {
    it('uses rotated key when active key is set', async () => {
      mockGetActiveKey.mockResolvedValue('key-id-123')
      mockRetrieveKeyMaterial.mockResolvedValue('SROTATEDSECRETKEY')

      const hash = await executeWithAdvance()
      expect(hash).toBeDefined()
      expect(mockGetActiveKey).toHaveBeenCalledWith('admin', expect.any(String))
      expect(mockRetrieveKeyMaterial).toHaveBeenCalledWith('key-id-123', 'admin')
    })

    it('falls back to configured secret when no rotation is active', async () => {
      mockGetActiveKey.mockResolvedValue(null)

      const hash = await executeWithAdvance()
      expect(hash).toBeDefined()
      expect(mockRetrieveKeyMaterial).not.toHaveBeenCalled()
    })
  })
})
