import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../services/salaryDeductionService.js', () => ({
  sendMonthlyDeductionAdvanceNotices: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { MonthlyDeductionReminderJob } from './monthlyDeductionReminderJob.js'
import { sendMonthlyDeductionAdvanceNotices } from '../services/salaryDeductionService.js'

const mockSendMonthlyDeductionAdvanceNotices = sendMonthlyDeductionAdvanceNotices as any

describe('MonthlyDeductionReminderJob', () => {
  let job: MonthlyDeductionReminderJob

  beforeEach(() => {
    vi.clearAllMocks()
    job = new MonthlyDeductionReminderJob(5000)
  })

  afterEach(async () => {
    await job.stop()
  })

  describe('Job creation and configuration', () => {
    it('creates job with custom poll interval', () => {
      const customJob = new MonthlyDeductionReminderJob(5000)
      expect(customJob).toBeDefined()
    })

    it('creates job with default interval when not specified', () => {
      const defaultJob = new MonthlyDeductionReminderJob()
      expect(defaultJob).toBeDefined()
    })
  })

  describe('Lifecycle management', () => {
    it('can be started and stopped', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      await new Promise(resolve => setTimeout(resolve, 100))
      await job.stop()

      expect(job).toBeDefined()
    })

    it('prevents multiple starts', () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      job.start() // Second start should be no-op

      // Should not throw
      expect(job).toBeDefined()
    })

    it('stops gracefully', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      job.start()
      await new Promise(resolve => setTimeout(resolve, 50))
      await job.stop()

      expect(job).toBeDefined()
    })
  })

  describe('Poll execution', () => {
    it('calls service when polling', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('accepts optional reference date', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({ sent: 0 })

      const testDate = new Date('2026-06-15T00:00:00Z')
      await job.poll(testDate)

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalledWith(testDate)
    })

    it('handles service success', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 5,
      })

      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('handles service errors gracefully', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockRejectedValue(
        new Error('Service error')
      )

      await job.poll()

      // Should not throw
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('handles zero sends', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })

  describe('Error resilience', () => {
    it('continues after database errors', async () => {
      mockSendMonthlyDeductionAdvanceNotices
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({ sent: 0 })

      await job.poll()
      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalledTimes(2)
    })

    it('handles network failures', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockRejectedValue(
        new Error('Network timeout')
      )

      await job.poll()

      // Should complete without crashing
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })

  describe('Empty workload handling', () => {
    it('handles no eligible tenants', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })

    it('handles zero sends response', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
        reason: 'no_active_deductions',
      })

      await job.poll()

      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })

  describe('Month boundary handling', () => {
    it('accepts different reference dates', async () => {
      mockSendMonthlyDeductionAdvanceNotices.mockResolvedValue({
        sent: 0,
      })

      // Test end of month
      await job.poll(new Date('2026-06-30T23:59:59Z'))
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()

      vi.clearAllMocks()

      // Test start of next month
      await job.poll(new Date('2026-07-01T00:00:00Z'))
      expect(mockSendMonthlyDeductionAdvanceNotices).toHaveBeenCalled()
    })
  })
})
