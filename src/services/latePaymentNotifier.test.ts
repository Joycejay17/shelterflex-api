import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockNotificationCreate = vi.fn()
const mockEnqueue = vi.fn().mockResolvedValue('job-1')

vi.mock('./notificationService.js', () => ({
  notificationService: {
    create: (...args: unknown[]) => mockNotificationCreate(...args),
  },
}))

vi.mock('../notifications/notificationService.js', () => ({
  getNotificationService: () => ({
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
  }),
}))

vi.mock('../notifications/types.js', () => ({
  NotificationChannel: { EMAIL: 'email', SMS: 'sms', PUSH: 'push' },
}))

vi.mock('../repositories/AuthRepository.js', () => ({
  PostgresUserRepository: vi.fn().mockImplementation(() => ({
    getById: vi.fn().mockResolvedValue({ email: 'tenant@example.com' }),
  })),
}))

const {
  sendLatePaymentNotification,
  setTestUserEmail,
  clearTestUserEmails,
} = await import('./latePaymentNotifier.js')

describe('sendLatePaymentNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTestUserEmails()
  })

  afterEach(() => {
    clearTestUserEmails()
  })

  const baseInput = {
    userId: 'user-1',
    title: 'Payment Due Reminder',
    body: 'Your rent payment is due tomorrow.',
    dedupeKey: 'late-payment:user-1:2024-01-15',
    template: 'payment_due' as const,
    data: { dealId: 'deal-1', amountNgn: 100000 },
  }

  describe('deduplication', () => {
    it('suppresses a second call with the same dedupeKey', async () => {
      setTestUserEmail('user-1', 'tenant@example.com')
      mockNotificationCreate.mockResolvedValue('notif-1')

      await sendLatePaymentNotification(baseInput)
      expect(mockNotificationCreate).toHaveBeenCalledTimes(1)

      await sendLatePaymentNotification(baseInput)
      expect(mockNotificationCreate).toHaveBeenCalledTimes(2)

      const secondCallArgs = mockNotificationCreate.mock.calls[1]
      expect(secondCallArgs[0]).toBe('user-1')
      expect(secondCallArgs[1].dedupeKey).toBe('late-payment:user-1:2024-01-15')
    })

    it('sends notifications for different dedupe keys', async () => {
      setTestUserEmail('user-1', 'tenant@example.com')
      mockNotificationCreate.mockResolvedValue('notif-1')

      await sendLatePaymentNotification(baseInput)
      expect(mockNotificationCreate).toHaveBeenCalledTimes(1)

      await sendLatePaymentNotification({
        ...baseInput,
        dedupeKey: 'late-payment:user-1:2024-02-15',
      })
      expect(mockNotificationCreate).toHaveBeenCalledTimes(2)

      const firstDedupe = mockNotificationCreate.mock.calls[0][1].dedupeKey
      const secondDedupe = mockNotificationCreate.mock.calls[1][1].dedupeKey
      expect(firstDedupe).not.toBe(secondDedupe)
    })
  })

  describe('dispatch', () => {
    it('dispatches with the correct category, title, body, data, and dedupeKey', async () => {
      setTestUserEmail('user-1', 'tenant@example.com')
      mockNotificationCreate.mockResolvedValue('notif-1')

      await sendLatePaymentNotification(baseInput)

      expect(mockNotificationCreate).toHaveBeenCalledWith('user-1', {
        category: 'payment',
        title: 'Payment Due Reminder',
        body: 'Your rent payment is due tomorrow.',
        data: { dealId: 'deal-1', amountNgn: 100000 },
        dedupeKey: 'late-payment:user-1:2024-01-15',
      })
    })

    it('enqueues email when user email is resolved', async () => {
      setTestUserEmail('user-1', 'tenant@example.com')
      mockNotificationCreate.mockResolvedValue('notif-1')

      await sendLatePaymentNotification(baseInput)

      expect(mockEnqueue).toHaveBeenCalledWith({
        channel: 'email',
        recipient: 'tenant@example.com',
        subject: 'Payment Due Reminder',
        body: 'Your rent payment is due tomorrow.',
        html: '<p>Your rent payment is due tomorrow.</p>',
        metadata: { template: 'payment_due', dealId: 'deal-1', amountNgn: 100000 },
      })
    })

    it('skips email enqueue when user email is not resolved', async () => {
      mockNotificationCreate.mockResolvedValue('notif-1')

      await sendLatePaymentNotification(baseInput)

      expect(mockNotificationCreate).toHaveBeenCalledTimes(1)
      expect(mockEnqueue).not.toHaveBeenCalled()
    })
  })

  describe('template variants', () => {
    it('passes payment_overdue template correctly', async () => {
      setTestUserEmail('user-1', 'tenant@example.com')
      mockNotificationCreate.mockResolvedValue('notif-1')

      await sendLatePaymentNotification({
        ...baseInput,
        title: 'Payment Overdue!',
        body: 'Your rent is 7 days overdue.',
        dedupeKey: 'late-payment:user-1:overdue:2024-01-22',
        template: 'payment_overdue',
      })

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ template: 'payment_overdue' }),
        }),
      )
    })
  })
})
