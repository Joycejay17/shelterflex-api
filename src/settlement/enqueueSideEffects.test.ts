/**
 * enqueueSideEffects tests
 *
 * Verifies idempotent side-effect enqueueing and transactional guarantees:
 *   1. enqueueSettlementSideEffectsInTransaction produces expected outbox entries
 *   2. Duplicate enqueue calls are idempotent (ON CONFLICT DO NOTHING)
 *   3. All three event types are enqueued with correct idempotency keys
 *   4. Memory queue version behaves identically for testing
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueSettlementSideEffectsInTransaction,
  enqueueSettlementSideEffectsMemory,
  getSettlementMemoryQueue,
  _clearSettlementMemoryQueue,
  type EnqueueContext,
} from './enqueueSideEffects.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<EnqueueContext> = {}): EnqueueContext {
  return {
    dealId: 'deal-abc',
    period: 1,
    tenantId: 'tenant-123',
    landlordId: 'landlord-456',
    amountNgn: 100000,
    ...overrides,
  }
}

function mockSqlClient() {
  const queryMock = vi.fn().mockResolvedValue({ rows: [] })
  return {
    query: queryMock,
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _clearSettlementMemoryQueue()
  vi.clearAllMocks()
})

afterEach(() => {
  _clearSettlementMemoryQueue()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. enqueueSettlementSideEffectsInTransaction
// ---------------------------------------------------------------------------

describe('enqueueSettlementSideEffectsInTransaction', () => {
  it('enqueues three outbox entries for a settlement', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    await enqueueSettlementSideEffectsInTransaction(client, ctx)

    expect(client.query).toHaveBeenCalledTimes(3)

    // Verify each event type was enqueued
    const calls = client.query.mock.calls
    const eventTypes = calls.map((call) => call[1]?.[3]) // event_type is at index 3
    expect(eventTypes).toContain('receipt_recorded')
    expect(eventTypes).toContain('notification_fanout')
    expect(eventTypes).toContain('audit_publish')
  })

  it('uses correct idempotency keys for each event type', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    await enqueueSettlementSideEffectsInTransaction(client, ctx)

    const calls = client.query.mock.calls
    const idempotencyKeys = calls.map((call) => call[1]?.[4]) // idempotency_key is at index 4

    expect(idempotencyKeys).toContain('deal:deal-abc:p1:receipt_recorded')
    expect(idempotencyKeys).toContain('deal:deal-abc:p1:notification_fanout')
    expect(idempotencyKeys).toContain('deal:deal-abc:p1:audit_publish')
  })

  it('includes payload with deal context for each event', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    await enqueueSettlementSideEffectsInTransaction(client, ctx)

    const calls = client.query.mock.calls
    
    // Each call should have a payload with the deal context
    for (const call of calls) {
      const payload = call[1]?.[5]
      const parsed = JSON.parse(payload as string)
      
      expect(parsed).toHaveProperty('dealId', 'deal-abc')
      expect(parsed).toHaveProperty('period', 1)
      expect(parsed).toHaveProperty('tenantId', 'tenant-123')
      expect(parsed).toHaveProperty('landlordId', 'landlord-456')
      expect(parsed).toHaveProperty('amountNgn', 100000)
    }
  })

  it('uses ON CONFLICT DO NOTHING for idempotency', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    await enqueueSettlementSideEffectsInTransaction(client, ctx)

    const calls = client.query.mock.calls
    
    // Verify each INSERT has ON CONFLICT clause
    for (const call of calls) {
      const sql = call[0] as string
      expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING')
    }
  })

  it('sets initial status to pending for all entries', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    await enqueueSettlementSideEffectsInTransaction(client, ctx)

    const calls = client.query.mock.calls
    
    // Verify each INSERT sets status to 'pending' in VALUES clause
    for (const call of calls) {
      const sql = call[0] as string
      expect(sql).toContain("'pending'")
      expect(sql).toContain('status')
    }
  })

  it('generates unique UUID for each entry', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    await enqueueSettlementSideEffectsInTransaction(client, ctx)

    const calls = client.query.mock.calls
    const ids = calls.map((call) => call[1]?.[0]) // id is at index 0

    // All IDs should be UUIDs
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    }

    // IDs should be unique
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 2. enqueueSettlementSideEffectsMemory (test helper)
// ---------------------------------------------------------------------------

describe('enqueueSettlementSideEffectsMemory', () => {
  it('enqueues three entries in memory queue', () => {
    const ctx = makeContext()
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(3)
  })

  it('sets status to pending for all entries', () => {
    const ctx = makeContext()
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    for (const entry of queue) {
      expect(entry.status).toBe('pending')
    }
  })

  it('initializes attempts to 0 for all entries', () => {
    const ctx = makeContext()
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    for (const entry of queue) {
      expect(entry.attempts).toBe(0)
    }
  })

  it('uses correct idempotency keys', () => {
    const ctx = makeContext()
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    const keys = queue.map((e) => e.idempotencyKey)

    expect(keys).toContain('deal:deal-abc:p1:receipt_recorded')
    expect(keys).toContain('deal:deal-abc:p1:notification_fanout')
    expect(keys).toContain('deal:deal-abc:p1:audit_publish')
  })

  it('includes payload with deal context', () => {
    const ctx = makeContext()
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    for (const entry of queue) {
      expect(entry.payload).toHaveProperty('dealId', 'deal-abc')
      expect(entry.payload).toHaveProperty('period', 1)
      expect(entry.payload).toHaveProperty('tenantId', 'tenant-123')
      expect(entry.payload).toHaveProperty('landlordId', 'landlord-456')
      expect(entry.payload).toHaveProperty('amountNgn', 100000)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('duplicate enqueue calls do not create duplicate memory entries', () => {
    const ctx = makeContext()
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)
    expect(getSettlementMemoryQueue()).toHaveLength(3)

    enqueueSettlementSideEffectsMemory(ctx)
    expect(getSettlementMemoryQueue()).toHaveLength(3) // Still 3, not 6
  })

  it('different settlements create independent entries', () => {
    const ctx1 = makeContext({ dealId: 'deal-abc', period: 1 })
    const ctx2 = makeContext({ dealId: 'deal-xyz', period: 2 })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx1)
    enqueueSettlementSideEffectsMemory(ctx2)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(6)

    const dealAbcEntries = queue.filter((r) => r.dealId === 'deal-abc')
    const dealXyzEntries = queue.filter((r) => r.dealId === 'deal-xyz')

    expect(dealAbcEntries).toHaveLength(3)
    expect(dealXyzEntries).toHaveLength(3)
  })

  it('same settlement with different periods creates independent entries', () => {
    const ctx1 = makeContext({ dealId: 'deal-abc', period: 1 })
    const ctx2 = makeContext({ dealId: 'deal-abc', period: 2 })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx1)
    enqueueSettlementSideEffectsMemory(ctx2)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(6)

    const period1Entries = queue.filter((r) => r.period === 1)
    const period2Entries = queue.filter((r) => r.period === 2)

    expect(period1Entries).toHaveLength(3)
    expect(period2Entries).toHaveLength(3)
  })

  it('idempotency keys are unique across all entries', () => {
    const ctx1 = makeContext({ dealId: 'deal-abc', period: 1 })
    const ctx2 = makeContext({ dealId: 'deal-xyz', period: 2 })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx1)
    enqueueSettlementSideEffectsMemory(ctx2)

    const queue = getSettlementMemoryQueue()
    const keys = queue.map((e) => e.idempotencyKey)
    const uniqueKeys = new Set(keys)

    expect(uniqueKeys.size).toBe(6)
  })

  it('SQL version uses ON CONFLICT to handle duplicates', async () => {
    const ctx = makeContext()
    const client = mockSqlClient()

    // First enqueue
    await enqueueSettlementSideEffectsInTransaction(client, ctx)
    expect(client.query).toHaveBeenCalledTimes(3)

    // Second enqueue (should use ON CONFLICT DO NOTHING)
    await enqueueSettlementSideEffectsInTransaction(client, ctx)
    expect(client.query).toHaveBeenCalledTimes(6) // Still called, but SQL handles duplicates

    // Verify all calls have ON CONFLICT
    const calls = client.query.mock.calls
    for (const call of calls) {
      const sql = call[0] as string
      expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles zero amount correctly', () => {
    const ctx = makeContext({ amountNgn: 0 })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(3)
    for (const entry of queue) {
      expect(entry.payload.amountNgn).toBe(0)
    }
  })

  it('handles large amount correctly', () => {
    const ctx = makeContext({ amountNgn: 999999999 })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(3)
    for (const entry of queue) {
      expect(entry.payload.amountNgn).toBe(999999999)
    }
  })

  it('handles long deal IDs', () => {
    const longDealId = 'a'.repeat(100)
    const ctx = makeContext({ dealId: longDealId })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(3)
    for (const entry of queue) {
      expect(entry.dealId).toBe(longDealId)
      expect(entry.idempotencyKey).toContain(longDealId)
    }
  })

  it('handles high period numbers', () => {
    const ctx = makeContext({ period: 999 })
    _clearSettlementMemoryQueue()

    enqueueSettlementSideEffectsMemory(ctx)

    const queue = getSettlementMemoryQueue()
    expect(queue).toHaveLength(3)
    for (const entry of queue) {
      expect(entry.period).toBe(999)
      expect(entry.idempotencyKey).toContain('p999')
    }
  })
})
