import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LatePaymentEscalationService } from './latePaymentEscalationService.js'
import type { LatePaymentConfig } from '../config/latePayment.js'
import { DealStatus, ScheduleItemStatus, type DealWithSchedule } from '../models/deal.js'
import { dealStore } from '../models/dealStore.js'
import { latePaymentEscalationStore } from '../models/latePaymentEscalationStore.js'
import { adminTaskStore } from '../models/adminTaskStore.js'
import { lateFeeService } from './lateFeeService.js'
import * as latePaymentNotifier from './latePaymentNotifier.js'

vi.mock('./latePaymentNotifier.js')
vi.mock('./lateFeeService.js')

describe('LatePaymentEscalationService', () => {
  const mockConfig: LatePaymentConfig = {
    gracePeriodDays: 3,
    lateFeeDay: 4,
    atRiskDay: 7,
    adminEscalationDay: 14,
    lateFeePercentage: 0.02,
  }

  let service: LatePaymentEscalationService

  beforeEach(() => {
    service = new LatePaymentEscalationService(mockConfig)
    dealStore.clear()
    latePaymentEscalationStore.clear()
    adminTaskStore.clear()
    vi.clearAllMocks()
  })

  it('sends due-today reminder at dpd=0', async () => {
    const dueDate = new Date('2024-01-01')
    const now = new Date('2024-01-01')
    const deal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(now)

    expect(latePaymentNotifier.sendLatePaymentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ step: 't0_due_today' }),
    )
  })

  it('sends grace reminder within grace period (1 ≤ dpd < gracePeriodDays)', async () => {
    const dueDate = new Date('2024-01-01')
    const now = new Date('2024-01-02')

    const deal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(now)

    expect(latePaymentNotifier.sendLatePaymentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ step: 't_grace_reminder' }),
    )
  })

  it('applies late fee exactly once at lateFeeDay', async () => {
    const dueDate = new Date('2024-01-01')
    const feeDay = new Date('2024-01-05')

    const deal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(feeDay)
    expect(lateFeeService.applyLateFee).toHaveBeenCalledOnce()

    vi.clearAllMocks()

    await service.processAllActiveDeals(new Date('2024-01-06'))
    expect(lateFeeService.applyLateFee).not.toHaveBeenCalled()
  })

  it('transitions deal to AT_RISK at atRiskDay', async () => {
    const dueDate = new Date('2024-01-01')
    const atRiskDate = new Date('2024-01-08')

    const deal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    expect(deal.status).toBe(DealStatus.ACTIVE)

    await service.processAllActiveDeals(atRiskDate)

    const updated = dealStore.getById(deal.id)
    expect(updated?.status).toBe(DealStatus.AT_RISK)
  })

  it('creates admin escalation task exactly once', async () => {
    const dueDate = new Date('2024-01-01')
    const escalationDate = new Date('2024-01-15')

    const deal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    const initialTaskCount = adminTaskStore.list().length

    await service.processAllActiveDeals(escalationDate)

    const taskCount = adminTaskStore.list().length
    expect(taskCount).toBeGreaterThan(initialTaskCount)

    vi.clearAllMocks()
    await service.processAllActiveDeals(new Date('2024-01-16'))

    expect(adminTaskStore.list().length).toBe(taskCount)
  })

  it('skips COMPLETED and DEFAULTED deals', async () => {
    const now = new Date('2024-01-15')
    const dueDate = new Date('2024-01-01')

    const completedDeal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PAID }])
    completedDeal.status = DealStatus.COMPLETED

    const defaultedDeal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])
    defaultedDeal.status = DealStatus.DEFAULTED

    await service.processAllActiveDeals(now)

    expect(latePaymentNotifier.sendLatePaymentNotification).not.toHaveBeenCalled()
  })

  it('de-duplicates notifications on same calendar day', async () => {
    const dueDate = new Date('2024-01-01')
    const atRiskDate = new Date('2024-01-08T10:00:00Z')

    const deal = createTestDeal([{ dueDate, status: ScheduleItemStatus.PENDING }])

    await service.processAllActiveDeals(atRiskDate)
    const firstCallCount = vi.mocked(latePaymentNotifier.sendLatePaymentNotification).mock.calls.length

    vi.clearAllMocks()

    await service.processAllActiveDeals(new Date('2024-01-08T18:00:00Z'))
    const secondCallCount = vi.mocked(latePaymentNotifier.sendLatePaymentNotification).mock.calls.length

    expect(secondCallCount).toBe(0)
  })
})

function createTestDeal(
  scheduleItems: Array<{ dueDate: Date; status: ScheduleItemStatus }>,
): DealWithSchedule {
  const deal: DealWithSchedule = {
    id: `deal-${Math.random()}`,
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    status: DealStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    schedule: scheduleItems.map((item, idx) => ({
      period: idx + 1,
      dueDate: item.dueDate,
      status: item.status,
      amountNgn: 100_000,
    })),
  }

  dealStore.save(deal)
  return deal
}
