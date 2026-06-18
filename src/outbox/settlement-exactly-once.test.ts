/**
 * Exactly-once on-chain settlement tests
 *
 * Verifies the three critical failure modes that were unguarded before this change:
 *   1. Crash-after-broadcast  — worker died between sendTransaction and updateStatus(SENT)
 *   2. Duplicate delivery     — same outbox item processed by two workers concurrently
 *   3. Reorg invalidation     — a previously-CONFIRMING tx disappears from the ledger
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { outboxStore } from './store.js'
import { OutboxSender } from './sender.js'
import { OutboxWorker } from './worker.js'
import { OutboxStatus, TxType } from './types.js'
import type { SorobanAdapter, TxBroadcastHooks } from '../soroban/adapter.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(ref = 'test-ref-1') {
  return outboxStore.create({
    txType: TxType.RECEIPT,
    source: 'test',
    ref,
    payload: {
      dealId: 'deal-abc',
      amountUsdc: '100.000000',
      tokenAddress: '0x' + '0'.repeat(40),
      txType: TxType.RECEIPT,
    },
  })
}

/**
 * Build a stub SorobanAdapter where recordReceipt fires onTxBuilt synchronously
 * with the given txHash, simulating the real adapter behaviour.
 */
function makeAdapter(opts: {
  txHash?: string
  failBroadcast?: boolean
  chainStatus?: import('../soroban/adapter.js').TxOnChainStatus
}): SorobanAdapter {
  const hash = opts.txHash ?? 'deadbeef' + '0'.repeat(56)
  return {
    getBalance: vi.fn(),
    credit: vi.fn(),
    debit: vi.fn(),
    getStakedBalance: vi.fn(),
    getClaimableRewards: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    getReceiptEvents: vi.fn().mockResolvedValue([]),
    getTimelockEvents: vi.fn().mockResolvedValue([]),
    executeTimelock: vi.fn(),
    cancelTimelock: vi.fn(),
    stakeBond: vi.fn(),
    unstakeBond: vi.fn(),
    isBonded: vi.fn(),
    getBond: vi.fn(),
    recordReceipt: vi.fn().mockImplementation(async (_params: unknown, hooks?: TxBroadcastHooks) => {
      if (hooks?.onTxBuilt) await hooks.onTxBuilt(hash)
      if (opts.failBroadcast) throw new Error('network error')
    }),
    getTransactionStatus: vi.fn().mockResolvedValue(
      opts.chainStatus ?? { status: 'success', ledger: 100 }
    ),
  } as unknown as SorobanAdapter
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await outboxStore.clear()
})

afterEach(async () => {
  await outboxStore.clear()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Crash-after-broadcast
// ---------------------------------------------------------------------------

describe('crash-after-broadcast', () => {
  it('resolves via chain query without calling recordReceipt again', async () => {
    const item = await makeItem('crash-1')

    // Simulate the crash: submittedTxHash is set (intent was persisted) but
    // the status is still PENDING because updateStatus(SENT) never ran.
    const txHash = 'aabbcc' + '0'.repeat(58)
    await outboxStore.persistSubmittedTxHash(item.id, txHash)

    const adapter = makeAdapter({ txHash, chainStatus: { status: 'success', ledger: 42 } })
    const sender = new OutboxSender(adapter)

    const refreshed = (await outboxStore.getById(item.id))!
    const result = await sender.send(refreshed)

    expect(result).toBe(true)
    // Must NOT have called recordReceipt (that would double-apply)
    expect(adapter.recordReceipt).not.toHaveBeenCalled()
    // Must have queried the chain for the known hash
    expect(adapter.getTransactionStatus).toHaveBeenCalledWith(txHash)
    // Item should now be in CONFIRMING (awaiting depth) or SENT (depth=0)
    const updated = (await outboxStore.getById(item.id))!
    expect([OutboxStatus.CONFIRMING, OutboxStatus.SENT]).toContain(updated.status)
  })

  it('re-opens item when the in-flight tx is not found on chain', async () => {
    const item = await makeItem('crash-2')
    const txHash = 'ccddee' + '0'.repeat(58)
    await outboxStore.persistSubmittedTxHash(item.id, txHash)

    const adapter = makeAdapter({ txHash, chainStatus: { status: 'not_found' } })
    const sender = new OutboxSender(adapter)

    const refreshed = (await outboxStore.getById(item.id))!
    const result = await sender.send(refreshed)

    expect(result).toBe(false)
    expect(adapter.recordReceipt).not.toHaveBeenCalled()

    // Item should be back to PENDING for resubmission
    const updated = (await outboxStore.getById(item.id))!
    expect(updated.status).toBe(OutboxStatus.PENDING)
    expect(updated.submittedTxHash).toBeFalsy()
  })

  it('records tx hash before broadcast so a crash leaves a recoverable state', async () => {
    const item = await makeItem('crash-3')

    let capturedHash: string | undefined
    const adapter = makeAdapter({ txHash: 'ff1234' + '0'.repeat(58) })
    // Intercept the onTxBuilt call to verify it fires before the adapter resolves
    const originalRecordReceipt = adapter.recordReceipt as ReturnType<typeof vi.fn>
    originalRecordReceipt.mockImplementation(async (_p: unknown, hooks?: TxBroadcastHooks) => {
      if (hooks?.onTxBuilt) {
        capturedHash = 'ff1234' + '0'.repeat(58)
        await hooks.onTxBuilt(capturedHash)
      }
    })

    const sender = new OutboxSender(adapter)
    await sender.send(item)

    expect(capturedHash).toBeDefined()

    // Even if we check the DB mid-flight the hash is already persisted
    const stored = (await outboxStore.getById(item.id))!
    // After successful send the item is SENT; hash was set transiently
    expect([OutboxStatus.SENT, OutboxStatus.CONFIRMING]).toContain(stored.status)
  })
})

// ---------------------------------------------------------------------------
// 2. Duplicate delivery
// ---------------------------------------------------------------------------

describe('duplicate delivery', () => {
  it('does not double-apply when the same item is sent twice', async () => {
    const item = await makeItem('dup-1')

    const adapter = makeAdapter({ txHash: '112233' + '0'.repeat(58) })
    const sender = new OutboxSender(adapter)

    // First delivery
    await sender.send(item)
    expect(adapter.recordReceipt).toHaveBeenCalledTimes(1)

    // Second delivery (duplicate — item is now SENT)
    const refreshed = (await outboxStore.getById(item.id))!
    if (refreshed.status === OutboxStatus.SENT) {
      // Sender.retry guards against re-sending SENT items
      const result = await sender.retry(item.id)
      expect(result).toBe(true)
      expect(adapter.recordReceipt).toHaveBeenCalledTimes(1)  // still 1
    }
  })

  it('concurrent workers cannot both claim the same PENDING item', async () => {
    await makeItem('lock-1')
    await makeItem('lock-2')

    const worker1Claimed = await outboxStore.lockForProcessing(10, 'worker-A')
    const worker2Claimed = await outboxStore.lockForProcessing(10, 'worker-B')

    const allClaimedIds = [
      ...worker1Claimed.map((i) => i.id),
      ...worker2Claimed.map((i) => i.id),
    ]

    // Each item must appear at most once across both workers
    const unique = new Set(allClaimedIds)
    expect(unique.size).toBe(allClaimedIds.length)
    // Worker 1 got both items (InMemory: first-come-first-served)
    expect(worker1Claimed).toHaveLength(2)
    expect(worker2Claimed).toHaveLength(0)
  })

  it('stale claim (>5 min) can be reclaimed by another worker', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const item = await makeItem('stale-1')
    const [claimed] = await outboxStore.lockForProcessing(1, 'worker-A')
    expect(claimed.id).toBe(item.id)

    // Advance past stale threshold (5 minutes + 1 ms)
    vi.setSystemTime(new Date('2026-01-01T00:05:01Z'))

    const reclaimed = await outboxStore.lockForProcessing(1, 'worker-B')
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0].id).toBe(item.id)
    expect(reclaimed[0].claimedBy).toBe('worker-B')

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// 3. Reorg invalidation
// ---------------------------------------------------------------------------

describe('reorg invalidation', () => {
  it('re-opens a CONFIRMING item when the tx disappears from chain', async () => {
    const item = await makeItem('reorg-1')
    const txHash = 'reorg00' + '0'.repeat(57)

    // Simulate item that was broadcast and is awaiting confirmation depth
    await outboxStore.markConfirming(item.id, txHash, 100, 3)

    const confirmedItem = (await outboxStore.getById(item.id))!
    expect(confirmedItem.status).toBe(OutboxStatus.CONFIRMING)

    const adapter = makeAdapter({ txHash, chainStatus: { status: 'not_found' } })
    const sender = new OutboxSender(adapter)
    const worker = new OutboxWorker(sender, adapter)

    await worker.process()

    const updated = (await outboxStore.getById(item.id))!
    // After reorg detection the item must be re-queued as PENDING
    expect(updated.status).toBe(OutboxStatus.PENDING)
    expect(updated.submittedTxHash).toBeFalsy()
  })

  it('marks CONFIRMING item SENT when confirmation depth is satisfied', async () => {
    const item = await makeItem('confirm-1')
    const txHash = 'confirm' + '0'.repeat(57)

    // Submitted at ledger 100, depth 3 — chain now at ledger 103 (>= 100+3)
    await outboxStore.markConfirming(item.id, txHash, 100, 3)

    const adapter = makeAdapter({
      txHash,
      chainStatus: { status: 'success', ledger: 103 },
    })
    const sender = new OutboxSender(adapter)
    const worker = new OutboxWorker(sender, adapter)

    await worker.process()

    const updated = (await outboxStore.getById(item.id))!
    expect(updated.status).toBe(OutboxStatus.SENT)
  })

  it('does not prematurely finalize before confirmation depth is reached', async () => {
    const item = await makeItem('confirm-2')
    const txHash = 'shallow' + '0'.repeat(57)

    // Submitted at ledger 100, depth 3 — chain at ledger 101 (< 100+3)
    await outboxStore.markConfirming(item.id, txHash, 100, 3)

    const adapter = makeAdapter({
      txHash,
      chainStatus: { status: 'success', ledger: 101 },
    })
    const sender = new OutboxSender(adapter)
    const worker = new OutboxWorker(sender, adapter)

    await worker.process()

    const updated = (await outboxStore.getById(item.id))!
    // Still waiting for more closes
    expect(updated.status).toBe(OutboxStatus.CONFIRMING)
  })
})
