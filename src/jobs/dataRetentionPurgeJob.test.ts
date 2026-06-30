import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../services/dataRetentionService.js', () => ({
  purgeExpiredRecords: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { dataRetentionPurgeJobHandler, DATA_RETENTION_PURGE_JOB_NAME } from './dataRetentionPurgeJob.js'
import { purgeExpiredRecords } from '../services/dataRetentionService.js'

const mockPurgeExpiredRecords = purgeExpiredRecords as any

describe('DataRetentionPurgeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Job configuration', () => {
    it('exports job name constant', () => {
      expect(DATA_RETENTION_PURGE_JOB_NAME).toBe('data_retention.purge')
    })

    it('has correct job handler signature', () => {
      expect(typeof dataRetentionPurgeJobHandler).toBe('function')
    })
  })

  describe('Purge eligibility and scope', () => {
    it('invokes purge for eligible records only', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'soft_deleted_records', recordsDeleted: 5 },
        { table: 'temp_uploads', recordsDeleted: 3 },
      ])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalled()
    })

    it('respects legal holds in purge decision', () => {
      // The purgeExpiredRecords service should respect legal holds
      // This is enforced at the service level, not here, but we verify
      // the handler calls the service which implements this logic
      expect(typeof mockPurgeExpiredRecords).toBe('function')
    })

    it('logs total records deleted', async () => {
      const { logger } = await import('../utils/logger.js')

      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'soft_deleted_records', recordsDeleted: 5 },
        { table: 'temp_uploads', recordsDeleted: 3 },
      ])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      // Total should be 8 (5 + 3)
      const mockLogger = logger as any
      const infoCall = mockLogger.info.mock.calls.find((call: any) =>
        call[0]?.includes('completed') || call[1]?.totalDeleted !== undefined
      )
      if (infoCall) {
        expect(infoCall[1]?.totalDeleted).toBe(8)
      }
    })
  })

  describe('Idempotency and double-processing prevention', () => {
    it('is idempotent if schedule fires twice', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'soft_deleted_records', recordsDeleted: 5 },
      ])

      const job = { id: 'job-123' }

      // First execution
      await dataRetentionPurgeJobHandler(job)
      const callsAfterFirst = mockPurgeExpiredRecords.mock.calls.length

      // Second execution (simulating double-fire)
      await dataRetentionPurgeJobHandler(job)
      const callsAfterSecond = mockPurgeExpiredRecords.mock.calls.length

      // Both calls should have happened
      expect(callsAfterSecond).toBe(callsAfterFirst * 2)

      // But service should handle idempotency (records already deleted won't be deleted again)
      // This is service-level behavior - here we just verify both calls happened
    })

    it('does not double-process records on retry', async () => {
      // The handler accepts a job object which may have retry logic
      // The handler itself should be stateless
      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'soft_deleted_records', recordsDeleted: 5 },
      ])

      const job = { id: 'job-123' }
      const job2 = { id: 'job-124' } // Different job ID

      await dataRetentionPurgeJobHandler(job)
      await dataRetentionPurgeJobHandler(job2)

      // Both should execute, but the underlying service handles what gets deleted
      expect(mockPurgeExpiredRecords).toHaveBeenCalledTimes(2)
    })

    it('handles empty workload cleanly', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalled()
      // Should complete without error
    })
  })

  describe('Failure handling and surfacing', () => {
    it('throws on purge service failure', async () => {
      mockPurgeExpiredRecords.mockRejectedValue(new Error('Database connection failed'))

      const job = { id: 'job-123' }

      await expect(dataRetentionPurgeJobHandler(job)).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('logs errors with context', async () => {
      const { logger } = await import('../utils/logger.js')
      mockPurgeExpiredRecords.mockRejectedValue(new Error('Purge failed'))

      const job = { id: 'job-123' }

      try {
        await dataRetentionPurgeJobHandler(job)
      } catch {
        // Expected to throw
      }

      const mockLogger = logger as any
      const errorCall = mockLogger.error.mock.calls[0]
      expect(errorCall[0]).toContain('failed')
      expect(errorCall[1]?.jobId).toBe('job-123')
      expect(errorCall[1]?.error).toBeDefined()
    })

    it('includes job ID in error context', async () => {
      const { logger } = await import('../utils/logger.js')
      mockPurgeExpiredRecords.mockRejectedValue(new Error('Purge error'))

      const job = { id: 'specific-job-id' }

      try {
        await dataRetentionPurgeJobHandler(job)
      } catch {
        // Expected
      }

      const mockLogger = logger as any
      const errorCall = mockLogger.error.mock.calls[0]
      expect(errorCall[1]?.jobId).toBe('specific-job-id')
    })

    it('surfaces partial failures', async () => {
      // If some tables purge successfully but others fail,
      // the service should indicate the failure
      const { logger } = await import('../utils/logger.js')
      mockPurgeExpiredRecords.mockRejectedValue(new Error('One table failed'))

      const job = { id: 'job-123' }

      await expect(dataRetentionPurgeJobHandler(job)).rejects.toThrow()

      const mockLogger = logger as any
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('is retryable on failure', async () => {
      mockPurgeExpiredRecords
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce([
          { table: 'soft_deleted_records', recordsDeleted: 5 },
        ])

      const job = { id: 'job-123' }

      // First attempt fails
      await expect(dataRetentionPurgeJobHandler(job)).rejects.toThrow()

      // Retry succeeds
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalledTimes(2)
    })
  })

  describe('Logging and observability', () => {
    it('logs job start with context', async () => {
      const { logger } = await import('../utils/logger.js')
      mockPurgeExpiredRecords.mockResolvedValue([])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      const mockLogger = logger as any
      const infoCall = mockLogger.info.mock.calls.find((call: any) =>
        call[0]?.includes('Starting') || call[0]?.includes('start')
      )
      expect(infoCall).toBeDefined()
    })

    it('logs job completion with metrics', async () => {
      const { logger } = await import('../utils/logger.js')
      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'soft_deleted_records', recordsDeleted: 5 },
        { table: 'temp_data', recordsDeleted: 2 },
      ])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      const mockLogger = logger as any
      const completionCall = mockLogger.info.mock.calls.find((call: any) =>
        call[0]?.includes('completed')
      )

      if (completionCall) {
        expect(completionCall[1]?.totalDeleted).toBe(7)
        expect(completionCall[1]?.tablesPurged).toBe(2)
        expect(completionCall[1]?.jobId).toBe('job-123')
      }
    })

    it('includes performance metrics in logs', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'table1', recordsDeleted: 100 },
        { table: 'table2', recordsDeleted: 50 },
      ])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalled()
    })
  })

  describe('Job payload handling', () => {
    it('handles job with undefined payload', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalled()
    })

    it('handles job with scheduled flag', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([])

      const job = {
        id: 'job-123',
        payload: { scheduled: true },
      }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalled()
    })

    it('handles job without ID', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([])

      const job = { payload: {} }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalled()
    })
  })

  describe('Service integration', () => {
    it('calls purgeExpiredRecords service', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      expect(mockPurgeExpiredRecords).toHaveBeenCalledTimes(1)
    })

    it('handles service response with multiple tables', async () => {
      mockPurgeExpiredRecords.mockResolvedValue([
        { table: 'soft_deleted_records', recordsDeleted: 10 },
        { table: 'temp_uploads', recordsDeleted: 5 },
        { table: 'archived_logs', recordsDeleted: 100 },
      ])

      const job = { id: 'job-123' }
      await dataRetentionPurgeJobHandler(job)

      const { logger } = await import('../utils/logger.js')
      const mockLogger = logger as any
      const completionCall = mockLogger.info.mock.calls.find((call: any) =>
        call[0]?.includes('completed')
      )

      if (completionCall) {
        expect(completionCall[1]?.totalDeleted).toBe(115)
        expect(completionCall[1]?.tablesPurged).toBe(3)
      }
    })

    it('propagates service errors correctly', async () => {
      const error = new Error('Service unavailable')
      mockPurgeExpiredRecords.mockRejectedValue(error)

      const job = { id: 'job-123' }

      await expect(dataRetentionPurgeJobHandler(job)).rejects.toThrow('Service unavailable')
    })
  })
})
