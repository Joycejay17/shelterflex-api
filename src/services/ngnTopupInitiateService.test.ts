import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitiatePayment = vi.fn()
const mockGetPaymentProvider = vi.fn(() => ({
  name: 'stub',
  initiatePayment: mockInitiatePayment,
  verifyPayment: vi.fn(),
  parseAndValidateWebhook: vi.fn(),
  mapStatus: vi.fn(),
}))

const mockCreateDeposit = vi.fn()
const mockGetByUserIdAndIdempotencyKey = vi.fn()
const mockAttachExternalRef = vi.fn()
const mockRecordTopUpPending = vi.fn()
const mockRecordPaymentInitiated = vi.fn()

vi.mock('../payments/index.js', () => ({
  getPaymentProvider: (...args: unknown[]) => mockGetPaymentProvider(...args),
}))

vi.mock('../models/ngnDepositStore.js', () => ({
  ngnDepositStore: {
    create: (...args: unknown[]) => mockCreateDeposit(...args),
    getByUserIdAndIdempotencyKey: (...args: unknown[]) => mockGetByUserIdAndIdempotencyKey(...args),
    attachExternalRef: (...args: unknown[]) => mockAttachExternalRef(...args),
  },
}))

vi.mock('./ngnWalletService.js', () => ({
  NgnWalletService: vi.fn().mockImplementation(
    class {
      recordTopUpPending = (...args: unknown[]) => mockRecordTopUpPending(...args)
    },
  ),
}))

vi.mock('../metrics.js', () => ({
  recordPaymentInitiated: (...args: unknown[]) => mockRecordPaymentInitiated(...args),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const { initiateNgnTopup } = await import('./ngnTopupInitiateService.js')

describe('initiateNgnTopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseParams = {
    userId: 'user-1',
    body: { amountNgn: 10000, rail: 'paystack' as const },
    idempotencyKey: 'idem-key-1',
  }

  describe('single-intent creation', () => {
    it('creates a deposit, calls PSP, attaches external ref, and returns 201', async () => {
      const deposit = { depositId: 'dep-1', userId: 'user-1', amountNgn: 10000, rail: 'paystack' }
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockResolvedValue(deposit)
      mockInitiatePayment.mockResolvedValue({
        externalRefSource: 'paystack',
        externalRef: 'pi_abc123',
        redirectUrl: 'https://pay.example.com',
      })
      mockAttachExternalRef.mockResolvedValue(deposit)

      const result = await initiateNgnTopup(baseParams)

      expect(result.status).toBe(201)
      expect(result.body.depositId).toBe('dep-1')
      expect(result.body.externalRefSource).toBe('paystack')
      expect(result.body.externalRef).toBe('pi_abc123')
      expect(result.body.redirectUrl).toBe('https://pay.example.com')
      expect(mockCreateDeposit).toHaveBeenCalledOnce()
      expect(mockInitiatePayment).toHaveBeenCalledWith({
        amountNgn: 10000,
        userId: 'user-1',
        internalRef: 'dep-1',
        rail: 'paystack',
      })
      expect(mockAttachExternalRef).toHaveBeenCalledWith({
        depositId: 'dep-1',
        externalRefSource: 'paystack',
        externalRef: 'pi_abc123',
        redirectUrl: 'https://pay.example.com',
        bankDetails: null,
      })
      expect(mockRecordTopUpPending).toHaveBeenCalledWith('dep-1', 10000, 'pi_abc123')
    })

    it('bank_transfer rail creates a bank transfer deposit without calling PSP', async () => {
      const deposit = { depositId: 'dep-bt', userId: 'user-1', amountNgn: 5000, rail: 'bank_transfer' }
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockResolvedValue(deposit)
      mockAttachExternalRef.mockResolvedValue(deposit)

      const result = await initiateNgnTopup({
        ...baseParams,
        body: { amountNgn: 5000, rail: 'bank_transfer' as const },
      })

      expect(result.status).toBe(201)
      expect(result.body.externalRefSource).toBe('bank')
      expect(result.body.externalRef).toBe('bnk_dep-bt')
      expect(result.body.bankDetails).toEqual({
        accountNumber: '1234567890',
        bankName: 'Example Bank',
      })
      expect(mockInitiatePayment).not.toHaveBeenCalled()
    })
  })

  describe('idempotency', () => {
    it('returns the existing deposit with status 200 on duplicate idempotency key', async () => {
      const existing = {
        depositId: 'dep-existing',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
        externalRefSource: 'paystack',
        externalRef: 'pi_existing',
        redirectUrl: 'https://pay.example.com',
        bankDetails: null,
      }
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(existing)

      const result = await initiateNgnTopup(baseParams)

      expect(result.status).toBe(200)
      expect(result.body.depositId).toBe('dep-existing')
      expect(result.body.externalRef).toBe('pi_existing')
      expect(mockCreateDeposit).not.toHaveBeenCalled()
      expect(mockInitiatePayment).not.toHaveBeenCalled()
    })

    it('throws CONFLICT 409 if existing deposit has no externalRef (initiation in progress)', async () => {
      const existing = {
        depositId: 'dep-in-progress',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
        externalRefSource: null,
        externalRef: null,
        redirectUrl: null,
        bankDetails: null,
      }
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(existing)

      await expect(initiateNgnTopup(baseParams)).rejects.toThrow('Deposit initiation is in progress')
    })

    it('returns 200 for bank_transfer idempotent call with bank details', async () => {
      const existing = {
        depositId: 'dep-bt-existing',
        userId: 'user-1',
        amountNgn: 5000,
        rail: 'bank_transfer',
        externalRefSource: 'bank',
        externalRef: 'bnk_dep-bt-existing',
        redirectUrl: null,
        bankDetails: { accountNumber: '1234567890', bankName: 'Example Bank' },
      }
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(existing)

      const result = await initiateNgnTopup({
        ...baseParams,
        body: { amountNgn: 5000, rail: 'bank_transfer' as const },
      })

      expect(result.status).toBe(200)
      expect(result.body.bankDetails).toEqual({ accountNumber: '1234567890', bankName: 'Example Bank' })
    })
  })

  describe('PSP failure handling', () => {
    it('records failed metric and re-throws when PSP throws', async () => {
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockResolvedValue({
        depositId: 'dep-fail',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
      })
      mockInitiatePayment.mockRejectedValue(new Error('PSP timeout'))

      await expect(initiateNgnTopup(baseParams)).rejects.toThrow('PSP timeout')
      expect(mockRecordPaymentInitiated).toHaveBeenCalledWith('paystack', 'failed')
    })

    it('records failed metric when deposit creation throws', async () => {
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockRejectedValue(new Error('db write failed'))

      await expect(initiateNgnTopup(baseParams)).rejects.toThrow('db write failed')
      expect(mockRecordPaymentInitiated).toHaveBeenCalledWith('paystack', 'failed')
    })

    it('does not leave dangling state when PSP fails before attachExternalRef', async () => {
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockResolvedValue({
        depositId: 'dep-dangle',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
      })
      mockInitiatePayment.mockRejectedValue(new Error('network error'))

      await expect(initiateNgnTopup(baseParams)).rejects.toThrow()
      expect(mockAttachExternalRef).not.toHaveBeenCalled()
      expect(mockRecordTopUpPending).not.toHaveBeenCalled()
    })
  })

  describe('reference and response shape', () => {
    it('returns a response matching ngnTopupInitiateResponseSchema shape', async () => {
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockResolvedValue({
        depositId: 'dep-shape',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
      })
      mockInitiatePayment.mockResolvedValue({
        externalRefSource: 'paystack',
        externalRef: 'pi_shape',
      })
      mockAttachExternalRef.mockResolvedValue({})

      const result = await initiateNgnTopup(baseParams)

      expect(result.body).toHaveProperty('success', true)
      expect(result.body).toHaveProperty('depositId', 'dep-shape')
      expect(result.body).toHaveProperty('externalRefSource', 'paystack')
      expect(result.body).toHaveProperty('externalRef', 'pi_shape')
      expect(result.body).toHaveProperty('depositId')
    })

    it('records success metric on successful initiation', async () => {
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue(null)
      mockCreateDeposit.mockResolvedValue({
        depositId: 'dep-metric',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
      })
      mockInitiatePayment.mockResolvedValue({
        externalRefSource: 'paystack',
        externalRef: 'pi_metric',
      })
      mockAttachExternalRef.mockResolvedValue({})

      await initiateNgnTopup(baseParams)

      expect(mockRecordPaymentInitiated).toHaveBeenCalledWith('paystack', 'success')
    })

    it('records success metric on idempotent return', async () => {
      mockGetByUserIdAndIdempotencyKey.mockResolvedValue({
        depositId: 'dep-idem',
        userId: 'user-1',
        amountNgn: 10000,
        rail: 'paystack',
        externalRefSource: 'paystack',
        externalRef: 'pi_idem',
        redirectUrl: null,
        bankDetails: null,
      })

      await initiateNgnTopup(baseParams)

      expect(mockRecordPaymentInitiated).toHaveBeenCalledWith('paystack', 'success')
    })
  })
})
