import { describe, it, expect, beforeEach } from 'vitest'
import { dealStore } from '../models/dealStore.js'
import { DealStatus } from '../models/deal.js'
import { installmentPaymentStore } from '../models/installmentPaymentStore.js'
import { latePaymentEscalationStore } from '../models/latePaymentEscalationStore.js'
import { LatePaymentEscalationService } from '../services/latePaymentEscalationService.js'
import { DEFAULT_LATE_PAYMENT_CONFIG } from '../config/latePayment.js'
import { vi } from 'vitest'
import * as notifier from '../services/latePaymentNotifier.js'

vi.mock('../notifications/notificationService.js', () => ({
  getNotificationService: () => ({ enqueue: vi.fn().mockResolvedValue('job') }),
}))

describe('LatePaymentJob performance', () => {
  beforeEach(async () => {
    vi.spyOn(notifier, 'sendLatePaymentNotification').mockResolvedValue()
    await dealStore.clear()
    installmentPaymentStore.clear()
    latePaymentEscalationStore.clear()
  })

  it('processes 1000 active deals within 60 seconds', async () => {
    const due = '2026-05-01T00:00:00.000Z'
    for (let i = 0; i < 1000; i++) {
      const deal = await dealStore.create({
        tenantId: `tenant-${i}`,
        landlordId: 'landlord-1',
        annualRentNgn: 1_200_000,
        depositNgn: 360_000,
        termMonths: 12,
      })
      await dealStore.updateStatus(deal.dealId, DealStatus.ACTIVE)
      await dealStore.setScheduleDueDateForTest(deal.dealId, 1, due)
    }

    const service = new LatePaymentEscalationService(DEFAULT_LATE_PAYMENT_CONFIG)
    const started = Date.now()
    const result = await service.processAllActiveDeals(new Date('2026-05-02T12:00:00.000Z'))
    const elapsed = Date.now() - started

    expect(result.dealsProcessed).toBe(1000)
    expect(elapsed).toBeLessThan(60_000)
  }, 90_000)
})
