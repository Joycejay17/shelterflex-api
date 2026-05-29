import { describe, it, expect, beforeEach, vi } from 'vitest'
import { dealStore } from '../models/dealStore.js'
import { DealStatus, ScheduleItemStatus } from '../models/deal.js'
import { installmentPaymentStore } from '../models/installmentPaymentStore.js'
import { latePaymentEscalationStore } from '../models/latePaymentEscalationStore.js'
import { adminTaskStore } from '../models/adminTaskStore.js'
import { userApplicationBlockStore } from '../models/userApplicationBlockStore.js'
import { LatePaymentEscalationService } from '../services/latePaymentEscalationService.js'
import { DEFAULT_LATE_PAYMENT_CONFIG, type LatePaymentConfig } from '../config/latePayment.js'
import * as notifier from '../services/latePaymentNotifier.js'

const config: LatePaymentConfig = { ...DEFAULT_LATE_PAYMENT_CONFIG }

vi.mock('../notifications/notificationService.js', () => ({
  getNotificationService: () => ({
    enqueue: vi.fn().mockResolvedValue('job-1'),
  }),
}))

async function createActiveDealWithDue(dueIso: string, tenantId = 'tenant-1') {
  const deal = await dealStore.create({
    tenantId,
    landlordId: 'landlord-1',
    annualRentNgn: 1_200_000,
    depositNgn: 360_000,
    termMonths: 12,
  })
  await dealStore.updateStatus(deal.dealId, DealStatus.ACTIVE)
  await dealStore.setScheduleDueDateForTest(deal.dealId, 1, dueIso)
  return deal.dealId
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
}

describe('LatePaymentEscalationService', () => {
  let notifySpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await dealStore.clear()
    installmentPaymentStore.clear()
    latePaymentEscalationStore.clear()
    adminTaskStore.clear()
    userApplicationBlockStore.clear()
    notifySpy = vi.spyOn(notifier, 'sendLatePaymentNotification').mockResolvedValue()
  })

  it('T+0 sends payment due today once per calendar day', async () => {
    const due = '2026-06-01T00:00:00.000Z'
    await createActiveDealWithDue(due)
    const service = new LatePaymentEscalationService(config)
    const now = utcDate(2026, 6, 1)

    await service.processAllActiveDeals(now)
    await service.processAllActiveDeals(now)

    const dueCalls = notifySpy.mock.calls.filter((c) => c[0].title === 'Payment due today')
    expect(dueCalls).toHaveLength(1)
  })

  it('T+1–T+3 sends daily grace reminders without late fee', async () => {
    await createActiveDealWithDue('2026-06-01T00:00:00.000Z')
    const service = new LatePaymentEscalationService(config)

    await service.processAllActiveDeals(utcDate(2026, 6, 2))
    await service.processAllActiveDeals(utcDate(2026, 6, 3))

    const paymentId = installmentPaymentStore.paymentId(
      (await dealStore.listActiveDealsWithSchedules())[0].dealId,
      1,
    )
    const payment = installmentPaymentStore.findByPaymentId(paymentId)
    expect(payment?.lateFeeApplied).toBeFalsy()

    const reminders = notifySpy.mock.calls.filter((c) => c[0].title === 'Payment reminder')
    expect(reminders.length).toBeGreaterThanOrEqual(2)
  })

  it('T+4 applies late fee exactly once', async () => {
    const dealId = await createActiveDealWithDue('2026-06-01T00:00:00.000Z')
    const service = new LatePaymentEscalationService(config)
    const now = utcDate(2026, 6, 5)

    await service.processAllActiveDeals(now)
    await service.processAllActiveDeals(now)

    const paymentId = installmentPaymentStore.paymentId(dealId, 1)
    const payment = installmentPaymentStore.findByPaymentId(paymentId)
    expect(payment?.lateFeeApplied).toBe(true)

    const feeNotices = notifySpy.mock.calls.filter((c) => c[0].title === 'Late fee applied')
    expect(feeNotices).toHaveLength(1)
  })

  it('T+7 flags deal at_risk', async () => {
    const dealId = await createActiveDealWithDue('2026-06-01T00:00:00.000Z')
    const service = new LatePaymentEscalationService(config)
    await service.processAllActiveDeals(utcDate(2026, 6, 8))

    const deal = await dealStore.findById(dealId)
    expect(deal?.status).toBe(DealStatus.AT_RISK)
  })

  it('T+14 creates admin task and notifies tenant and landlord', async () => {
    await createActiveDealWithDue('2026-06-01T00:00:00.000Z')
    const service = new LatePaymentEscalationService(config)
    await service.processAllActiveDeals(utcDate(2026, 6, 15))

    expect(adminTaskStore.listOpen().length).toBeGreaterThanOrEqual(1)
    const escalations = notifySpy.mock.calls.filter((c) =>
      c[0].title.includes('escalation'),
    )
    expect(escalations.length).toBeGreaterThanOrEqual(2)
  })

  it('T+30 defaults deal and blocks new applications only', async () => {
    const dealId = await createActiveDealWithDue('2026-06-01T00:00:00.000Z', 'tenant-default')
    const service = new LatePaymentEscalationService(config)
    await service.processAllActiveDeals(utcDate(2026, 7, 1))

    const deal = await dealStore.findById(dealId)
    expect(deal?.status).toBe(DealStatus.DEFAULTED)
    expect(userApplicationBlockStore.isBlocked('tenant-default')).toBe(true)
  })

  it('fully paid deal never enters at_risk', async () => {
    const dealId = await createActiveDealWithDue('2026-01-01T00:00:00.000Z')
    const deal = await dealStore.findById(dealId)
    if (!deal) throw new Error('missing deal')
    for (const item of deal.schedule) {
      await dealStore.updateScheduleItemStatus(dealId, item.period, ScheduleItemStatus.PAID)
    }

    const service = new LatePaymentEscalationService(config)
    await service.processAllActiveDeals(utcDate(2026, 6, 15))

    const updated = await dealStore.findById(dealId)
    expect(updated?.status).toBe(DealStatus.ACTIVE)
    expect(adminTaskStore.listOpen()).toHaveLength(0)
  })
})
