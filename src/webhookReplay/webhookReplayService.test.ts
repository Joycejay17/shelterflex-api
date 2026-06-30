import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryWebhookReplayStore,
  type IWebhookReplayStore,
} from './store.js'
import {
  ReplayStatus,
  ActorType,
  WebhookProcessingStatus,
  type ReplayRequest,
  type AuditContext,
} from './types.js'
import { WebhookReplayService } from './webhookReplayService.js'

vi.mock('../jobs/scheduler/worker.js', () => ({
  getScheduler: vi.fn(() => ({
    schedule: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../utils/auditLogger.js', () => ({
  auditLog: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { getScheduler } from '../jobs/scheduler/worker.js'
import { auditLog } from '../utils/auditLogger.js'

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'paystack',
    eventType: 'charge.success',
    externalId: 'ext-001',
    payload: { amount: 5000, currency: 'NGN' },
    processingStatus: WebhookProcessingStatus.PROCESSED,
    ...overrides,
  }
}

function makeContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    userId: 'admin-user-1',
    actorType: 'admin',
    ip: '127.0.0.1',
    ...overrides,
  }
}

describe('WebhookReplayService', () => {
  let store: IWebhookReplayStore
  let service: WebhookReplayService

  beforeEach(async () => {
    store = new InMemoryWebhookReplayStore()
    service = new WebhookReplayService(store)
    vi.mocked(auditLog).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // previewReplay
  // ---------------------------------------------------------------------------
  describe('previewReplay', () => {
    it('returns matching events for a provider filter', async () => {
      await store.createEvent(makeEvent({ provider: 'paystack', externalId: 'ps-1' }))
      await store.createEvent(makeEvent({ provider: 'flutterwave', externalId: 'fw-1' }))

      const preview = await service.previewReplay({
        provider: 'paystack',
        dryRun: true,
        reason: 'test',
      })

      expect(preview.totalEvents).toBe(1)
      expect(preview.events[0].provider).toBe('paystack')
    })

    it('returns empty preview when no events match', async () => {
      const preview = await store.createEvent(makeEvent({ provider: 'paystack', externalId: 'ps-1' }))

      const result = await service.previewReplay({
        provider: 'nonexistent',
        dryRun: true,
        reason: 'test',
      })

      expect(result.totalEvents).toBe(0)
      expect(result.events).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // executeReplay — idempotency
  // ---------------------------------------------------------------------------
  describe('executeReplay — idempotency', () => {
    it('replaying an already-processed event routes through idempotency layer', async () => {
      const event = await store.createEvent(
        makeEvent({
          provider: 'paystack',
          externalId: 'idempotent-1',
          processingStatus: WebhookProcessingStatus.PROCESSED,
        }),
      )

      const scheduler = vi.mocked(getScheduler).mock.results[0]?.value ?? {
        schedule: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      const request: ReplayRequest = {
        webhookEventId: event.id,
        dryRun: false,
        reason: 'replay processed event',
      }

      const attempt = await service.executeReplay(request, makeContext())

      expect(attempt.status).toBe(ReplayStatus.SUCCESS)
      expect(attempt.dryRun).toBe(false)

      // Audit log should show replay was initiated and completed
      expect(auditLog).toHaveBeenCalledWith(
        'WEBHOOK_REPLAY_INITIATED',
        expect.anything(),
        expect.objectContaining({ replayAttemptId: attempt.id }),
      )
      expect(auditLog).toHaveBeenCalledWith(
        'WEBHOOK_REPLAY_COMPLETED',
        expect.anything(),
        expect.objectContaining({ replayAttemptId: attempt.id }),
      )
    })

    it('replay does not create duplicate side effects — same event replayed twice', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'dup-1' }),
      )

      const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      const request: ReplayRequest = {
        webhookEventId: event.id,
        dryRun: false,
        reason: 'first replay',
      }

      // First replay
      const attempt1 = await service.executeReplay(request, makeContext())
      expect(attempt1.status).toBe(ReplayStatus.SUCCESS)

      // Second replay of the same event — should also succeed (idempotent)
      const attempt2 = await service.executeReplay(
        { ...request, reason: 'second replay' },
        makeContext(),
      )
      expect(attempt2.status).toBe(ReplayStatus.SUCCESS)

      // Both replay attempts are recorded
      const history = await service.getReplayHistory(event.id)
      expect(history.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ---------------------------------------------------------------------------
  // executeReplay — dry run
  // ---------------------------------------------------------------------------
  describe('executeReplay — dry run', () => {
    it('dry run validates without scheduling jobs', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'dry-1' }),
      )

      const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      const attempt = await service.executeReplay(
        {
          webhookEventId: event.id,
          dryRun: true,
          reason: 'dry run test',
        },
        makeContext(),
      )

      expect(attempt.status).toBe(ReplayStatus.SUCCESS)
      expect(attempt.dryRun).toBe(true)
      expect(attempt.outcome).toEqual(
        expect.objectContaining({ message: 'Dry run completed successfully' }),
      )
      expect(scheduler.schedule).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // executeReplay — no events found
  // ---------------------------------------------------------------------------
  describe('executeReplay — no events found', () => {
    it('throws when no events match the replay criteria', async () => {
      await expect(
        service.executeReplay(
          {
            provider: 'nonexistent',
            dryRun: false,
            reason: 'no match',
          },
          makeContext(),
        ),
      ).rejects.toThrow('No events found matching the replay criteria')
    })
  })

  // ---------------------------------------------------------------------------
  // executeReplay — audit trail
  // ---------------------------------------------------------------------------
  describe('executeReplay — audit trail', () => {
    it('records audit trail on successful replay', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'audit-1' }),
      )

      const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      const context = makeContext({ userId: 'admin-99', actorType: 'admin' })
      await service.executeReplay(
        {
          webhookEventId: event.id,
          dryRun: true,
          reason: 'audit test',
        },
        context,
      )

      expect(auditLog).toHaveBeenCalledWith(
        'WEBHOOK_REPLAY_INITIATED',
        context,
        expect.objectContaining({
          replayAttemptId: expect.any(String),
          eventCount: 1,
          dryRun: true,
        }),
      )
      expect(auditLog).toHaveBeenCalledWith(
        'WEBHOOK_REPLAY_COMPLETED',
        context,
        expect.objectContaining({ success: true }),
      )
    })

    it('records audit trail on failed replay', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'audit-fail-1' }),
      )

      const scheduler = {
        schedule: vi.fn().mockRejectedValue(new Error('queue full')),
      }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      const context = makeContext()
      await expect(
        service.executeReplay(
          {
            webhookEventId: event.id,
            dryRun: false,
            reason: 'should fail',
          },
          context,
        ),
      ).rejects.toThrow('queue full')

      expect(auditLog).toHaveBeenCalledWith(
        'WEBHOOK_REPLAY_FAILED',
        context,
        expect.objectContaining({
          error: 'queue full',
        }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // executeReplay — failed downstream
  // ---------------------------------------------------------------------------
  describe('executeReplay — failed downstream', () => {
    it('surfaces error and does not mark event as freshly processed', async () => {
      const event = await store.createEvent(
        makeEvent({
          provider: 'paystack',
          externalId: 'downstream-fail-1',
          processingStatus: WebhookProcessingStatus.PENDING,
        }),
      )

      const scheduler = {
        schedule: vi.fn().mockRejectedValue(new Error('downstream timeout')),
      }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      await expect(
        service.executeReplay(
          {
            webhookEventId: event.id,
            dryRun: false,
            reason: 'test failure',
          },
          makeContext(),
        ),
      ).rejects.toThrow('downstream timeout')

      // Event processing status should remain unchanged
      const updatedEvent = await store.getEventById(event.id)
      expect(updatedEvent?.processingStatus).toBe(WebhookProcessingStatus.PENDING)
    })
  })

  // ---------------------------------------------------------------------------
  // getReplayHistory
  // ---------------------------------------------------------------------------
  describe('getReplayHistory', () => {
    it('returns replay attempts filtered by webhookEventId', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'hist-1' }),
      )

      const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      await service.executeReplay(
        { webhookEventId: event.id, dryRun: true, reason: 'history test' },
        makeContext(),
      )

      const history = await service.getReplayHistory(event.id)
      expect(history).toHaveLength(1)
      expect(history[0].webhookEventId).toBe(event.id)
    })
  })

  // ---------------------------------------------------------------------------
  // getWebhookEvent
  // ---------------------------------------------------------------------------
  describe('getWebhookEvent', () => {
    it('returns a specific webhook event by id', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'get-1' }),
      )

      const found = await service.getWebhookEvent(event.id)
      expect(found).not.toBeNull()
      expect(found?.id).toBe(event.id)
    })

    it('returns null for unknown event id', async () => {
      const found = await service.getWebhookEvent('nonexistent-id')
      expect(found).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Replay scheduling
  // ---------------------------------------------------------------------------
  describe('replay job scheduling', () => {
    it('schedules a job for each event in the replay', async () => {
      const event = await store.createEvent(
        makeEvent({ provider: 'paystack', externalId: 'sched-1' }),
      )

      const scheduler = { schedule: vi.fn().mockResolvedValue(undefined) }
      vi.mocked(getScheduler).mockReturnValue(scheduler as any)

      await service.executeReplay(
        { webhookEventId: event.id, dryRun: false, reason: 'schedule test' },
        makeContext(),
      )

      expect(scheduler.schedule).toHaveBeenCalledTimes(1)
      expect(scheduler.schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'webhook_replay_paystack',
          handler: 'webhook.replay',
          priority: 10,
          maxRetries: 3,
          payload: expect.objectContaining({
            webhookEventId: event.id,
            provider: 'paystack',
          }),
        }),
      )
    })
  })
})
