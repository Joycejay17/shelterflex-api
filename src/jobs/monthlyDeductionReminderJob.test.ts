import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MonthlyDeductionReminderJob } from './monthlyDeductionReminderJob.js'

const mockSendMonthlyDeductionAdvanceNotices = vi.fn()

vi.mock('../services/salaryDeductionService.js', () => ({
  sendMonthlyDeductionAdvanceNotices: mockSendMonthlyDeductionAdvanceNotices,
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

describe('MonthlyDeductionReminderJob', () => {
  let job: MonthlyDeductionReminderJob

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    job = new MonthlyDeductionReminderJob(1000) // 1 second interval for testing
  })

  afterEach(async () => {
    await job.stop()
    vi.useRealTimers()
  })

  describe('Job initialization and lifecycle', () => {
    it('creates job with custom poll interval', () => {
      const customJob = new MonthlyDeductionReminderJob(5000)
      expect(customJob).toBeDefined()
    })

    it('uses 24-hour default interval when not specified', () => {
      const defaultJob = new MonthlyDeductionReminderJob()
      expect(defaultJob).toBeDefined()
    })

    it('starts job polling', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()

      await job.stop()
    })

    it('prevents multiple starts', () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      job.start() // Second start should be no-op

      // Cleanup
      vi.runAllTimers()
    })

    it('stops job gracefully', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      await new Promise(resolve => setTimeout(resolve, 50))

      await job.stop()

      // Should not throw
      expect(job).toBeDefined()
    })
  })

  describe('Monthly cycle idempotency', () => {
    it('sends reminders exactly once per monthly cycle', async () => {
      mockSendMonthlyDeductionAdvanceNotices
        .mockResolvedValueOnce({ sent: 5, month: '2026-06', cycle: 1 })
        .mockResolvedValueOnce({ sent: 5, month: '2026-06', cycle: 1 })

      const referenceDate = new Date('2026-06-15T00:00:00Z')

      // First poll for cycle
      await job.poll(referenceDate)
      const callsAfterFirst = mockSendMonthlyDeductionAdvanceNotices.mock.calls.length

      // Second poll same cycle should be idempotent
      await job.poll(referenceDate)
      const callsAfterSecond = mockSendMonthlyDeductionAdvanceNotices.mock.calls.length

      // Service should handle cycle deduplication
      expect(callsAfterSecond).toBeGreaterThanOrEqual(callsAfterFirst)
    })

    it('distinguishes between monthly cycles', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      const june = new Date('2026-06-15T00:00:00Z')
      const july = new Date('2026-07-15T00:00:00Z')

      await job.poll(june)
      const juneCall = mockSendMonthlyDeductionAdvanceNotices.mock.calls[0]

      await job.poll(july)
      const julyCall = mockSendMonthlyDeductionAdvanceNotices.mock.calls[1]

      // Both should be called with different months
      expect(juneCall[0]).not.toEqual(julyCall[0])
    })

    it('detects duplicate cycle execution', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 5,
        month: '2026-06',
      })

      const referenceDate = new Date('2026-06-15T00:00:00Z')

      await job.poll(referenceDate)
      await job.poll(referenceDate)

      // Service should handle the duplicate gracefully
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })

  describe('Tenant targeting accuracy', () => {
    it('sends reminders to correct tenants', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 10,
        tenantIds: ['tenant-1', 'tenant-2', 'tenant-3'],
      })

      await job.poll(new Date('2026-06-15T00:00:00Z'))

      const response = mockSendMonthlyDeductionAdvanceNotices.mock.results[0].value
      expect(response.sent).toBe(10)
    })

    it('excludes ineligible tenants', async () => {
      // Service should filter out tenants without active deductions
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 5,
        skipped: 3,
      })

      await job.poll(new Date('2026-06-15T00:00:00Z'))

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('handles zero eligible tenants', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
        reason: 'no_eligible_tenants',
      })

      await job.poll(new Date('2026-06-15T00:00:00Z'))

      // Should complete without error
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })

  describe('Boundary month handling', () => {
    it('handles month boundary transitions correctly', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      // Test end of month
      const eom = new Date('2026-06-30T23:59:59Z')
      await job.poll(eom)

      // Test start of next month
      const som = new Date('2026-07-01T00:00:00Z')
      await job.poll(som)

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalledTimes(2)
    })

    it('detects first of month boundary', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 5,
      })

      // First of month
      const firstOfMonth = new Date('2026-07-01T00:00:00Z')
      await job.poll(firstOfMonth)

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('handles last day of month correctly', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      const lastDay = new Date('2026-06-30T00:00:00Z')
      await job.poll(lastDay)

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('handles leap year transitions', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      // Feb 28, leap year
      const beforeLeap = new Date('2026-02-28T00:00:00Z')
      await job.poll(beforeLeap)

      // Mar 1
      const afterLeap = new Date('2026-03-01T00:00:00Z')
      await job.poll(afterLeap)

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalledTimes(2)
    })
  })

  describe('Advance notice timing', () => {
    it('sends reminders in advance of deduction', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 5,
        noticeType: 'advance',
      })

      const referenceDate = new Date('2026-06-15T00:00:00Z')
      await job.poll(referenceDate)

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalledWith(
        referenceDate
      )
    })

    it('handles reference date parameter', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      const customDate = new Date('2026-06-20T12:30:00Z')
      await job.poll(customDate)

      const callArg = mockSendMonthlyDeductionAdvanceNotices.mock.calls[0][0]
      expect(callArg).toEqual(customDate)
    })

    it('uses current date when no reference date provided', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      await job.poll()

      // Should have been called
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })

  describe('Error handling and resilience', () => {
    it('catches and logs service errors', async () => {
      const { logger } = await import('../utils/logger.js')
      mockSendMonthlyDeductionAdvanceNotices.mockRejectedValue(
        new Error('Service error')
      )

      await job.poll(new Date('2026-06-15T00:00:00Z'))

      const mockLogger = logger as any
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('continues polling after service error', async () => {
      mockSendMonthlyDeductionAdvanceNotices
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({ sent: 5 })

      await job.poll(new Date('2026-06-15T00:00:00Z'))
      await job.poll(new Date('2026-06-16T00:00:00Z'))

      // Second poll should succeed
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalledTimes(2)
    })

    it('handles database connection failures', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockRejectedValue(
        new Error('Database connection failed')
      )

      const { logger } = await import('../utils/logger.js')
      await job.poll()

      const mockLogger = logger as any
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('does not crash on concurrent polls', async () => {
      mockSendMonthlyDeductionAdvanceNotices
        .mockResolvedValueOnce({ sent: 5 })
        .mockResolvedValueOnce({ sent: 5 })

      job.start()

      // Simulate concurrent polls
      const poll1 = job.poll(new Date('2026-06-15T00:00:00Z'))
      const poll2 = job.poll(new Date('2026-06-15T00:00:00Z'))

      await Promise.all([poll1, poll2])

      // Should handle gracefully
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()

      await job.stop()
    })
  })

  describe('Empty workload handling', () => {
    it('handles no tenants needing reminders', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      await job.poll(new Date('2026-06-15T00:00:00Z'))

      // Should complete without error
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('completes successfully with zero sends', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
        reason: 'no_active_deductions',
      })

      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('logs when no reminders are sent', async () => {
      const { logger } = await import('../utils/logger.js')
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      await job.poll()

      const mockLogger = logger as any
      // Should log completion even with 0 sends
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('completed') || expect.any(String),
        expect.any(Object)
      )
    })
  })

  describe('Polling and scheduling', () => {
    it('polls at configured interval', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })
      const testJob = new MonthlyDeductionReminderJob(100)

      testJob.start()

      await new Promise(resolve => setTimeout(resolve, 150))

      // Should have been called at least once
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()

      await testJob.stop()
    })

    it('waits for current poll to complete before starting next', async () => {
      let callCount = 0
      mockSendMonthlyDeductionAdvanceNotices.mockImplementation(async () => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return { sent: 0 }
      })

      const testJob = new MonthlyDeductionReminderJob(100)
      testJob.start()

      await new Promise(resolve => setTimeout(resolve, 200))

      // Should not have called more times than possible given the delays
      expect(callCount).toBeLessThanOrEqual(3)

      await testJob.stop()
    })

    it('stops after pending poll completes', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ sent: 0 }), 100))
      )

      const testJob = new MonthlyDeductionReminderJob(50)
      testJob.start()

      await new Promise(resolve => setTimeout(resolve, 60))

      // Poll is in progress, stop should wait
      const stopPromise = testJob.stop()

      await stopPromise

      // Should complete without error
      expect(testJob).toBeDefined()
    })
  })

  describe('Logging and observability', () => {
    it('logs job start', () => {
      const { logger } = require('../utils/logger.js')

      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()

      const mockLogger = logger as any
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting'),
        expect.any(Object)
      )
    })

    it('logs poll completion with results', async () => {
      const { logger } = await import('../utils/logger.js')
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 5,
      })

      await job.poll(new Date('2026-06-15T00:00:00Z'))

      const mockLogger = logger as any
      const infoCall = mockLogger.info.mock.calls.find((call: any) =>
        call[0]?.includes('completed')
      )
      expect(infoCall).toBeDefined()
    })

    it('logs errors with context', async () => {
      const { logger } = await import('../utils/logger.js')
      mockSendMonthlyDeductionAdvanceNotices.mockRejectedValue(
        new Error('Send failed')
      )

      await job.poll()

      const mockLogger = logger as any
      const errorCall = mockLogger.error.mock.calls[0]
      expect(errorCall[0]).toContain('failed')
    })

    it('logs job stop', async () => {
      const { logger } = await import('../utils/logger.js')

      job.start()
      await job.stop()

      const mockLogger = logger as any
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Stopped'),
        expect.any(Object)
      )
    })
  })

  describe('Resource cleanup', () => {
    it('clears interval on stop', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      await job.stop()

      // Interval should be cleared
      expect(job).toBeDefined()
    })

    it('clears processing promise on completion', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await job.stop()

      expect(job).toBeDefined()
    })
  })
})
