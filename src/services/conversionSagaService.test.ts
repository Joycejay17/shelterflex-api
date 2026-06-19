import { describe, it, expect, beforeEach } from 'vitest'

import {
  ConversionSagaService,
  type ConversionFiatLeg,
  type ConversionOnchainLeg,
} from './conversionSagaService.js'
import { StubConversionProvider } from './conversionProvider.js'
import { conversionSagaStore } from '../models/conversionSagaStore.js'
import { _resetDurableIdempotencyMemory } from './durableIdempotencyService.js'

/**
 * Failure-injection tests for the atomic conversion saga.
 *
 * Acceptance criteria exercised here:
 *  - fiat-ok / chain-fail        -> refund (compensation) fires; no torn state.
 *  - chain-ok / receipt-fail     -> forward recovery, no double mint.
 *  - rate-expired                -> execution rejected.
 *  - retry storms                -> no duplication (idempotency holds).
 *  - fiat-commit-fail            -> chain leg never starts.
 */

const RATE = 1600 // NGN per USDC (StubConversionProvider)

/**
 * In-memory fiat ledger that records every commit/refund so tests can assert
 * "debited exactly once" / "refunded exactly once". Idempotent on (ref) like
 * the real NgnWalletService reversal path.
 */
class FakeFiatLeg implements ConversionFiatLeg {
  commits: string[] = []
  refunds: string[] = []
  failCommit = false
  private committed = new Set<string>()
  private refunded = new Set<string>()

  async commit(input: { userId: string; refSource: string; ref: string; amountNgn: number }) {
    if (this.failCommit) {
      throw new Error('Simulated fiat commit failure')
    }
    if (this.committed.has(input.ref)) return // idempotent
    this.committed.add(input.ref)
    this.commits.push(input.ref)
  }

  async refund(input: { userId: string; ref: string; amountNgn: number; reversalRef: string }) {
    if (this.refunded.has(input.reversalRef)) return // idempotent
    this.refunded.add(input.reversalRef)
    this.refunds.push(input.reversalRef)
  }

  /** Net fiat position from the ledger's perspective. */
  net(amountNgn: number): number {
    return this.commits.length * -amountNgn + this.refunds.length * amountNgn
  }
}

/** On-chain leg whose behaviour is injectable per-test. */
class FakeOnchainLeg implements ConversionOnchainLeg {
  submitCalls = 0
  mode: 'confirm' | 'queue' | 'throw' = 'confirm'

  async submit(): Promise<{ confirmed: boolean; outboxId: string }> {
    this.submitCalls += 1
    if (this.mode === 'throw') {
      throw new Error('Simulated unrecoverable on-chain failure')
    }
    return { confirmed: this.mode === 'confirm', outboxId: `outbox-${this.submitCalls}` }
  }
}

function makeService(
  fiat: FakeFiatLeg,
  chain: FakeOnchainLeg,
  overrides: Partial<{ rateLockTtlMs: number; maxSlippage: number }> = {},
) {
  return new ConversionSagaService(new StubConversionProvider(RATE), 'onramp', fiat, chain, {
    rateLockTtlMs: 60_000,
    maxSlippage: 0.05,
    ...overrides,
  })
}

describe('ConversionSagaService — atomic conversion saga', () => {
  beforeEach(async () => {
    await conversionSagaStore.clear()
    _resetDurableIdempotencyMemory()
  })

  it('happy path: fiat committed + chain confirmed -> completed', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    chain.mode = 'confirm'
    const svc = makeService(fiat, chain)

    const saga = await svc.convert({
      depositId: 'dep-happy',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })

    expect(saga.state).toBe('completed')
    expect(saga.amountUsdc).toBe('100.000000') // 160000 / 1600
    expect(fiat.commits).toHaveLength(1)
    expect(fiat.refunds).toHaveLength(0)
    expect(chain.submitCalls).toBe(1)
  })

  it('fiat-ok / chain-fail -> compensation fires, fiat refunded, no torn state', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    chain.mode = 'throw'
    const svc = makeService(fiat, chain)

    const saga = await svc.convert({
      depositId: 'dep-chainfail',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })

    expect(saga.state).toBe('compensated')
    expect(fiat.commits).toHaveLength(1)
    expect(fiat.refunds).toHaveLength(1)
    expect(saga.compensationRef).toBe(`conv-refund:${saga.sagaId}`)
    // No torn state: net fiat position is zero (debited then refunded).
    expect(fiat.net(160_000)).toBe(0)
  })

  it('fiat-commit-fail -> chain leg never starts, saga failed', async () => {
    const fiat = new FakeFiatLeg()
    fiat.failCommit = true
    const chain = new FakeOnchainLeg()
    const svc = makeService(fiat, chain)

    await expect(
      svc.convert({ depositId: 'dep-fiatfail', userId: 'u1', kind: 'deposit', amountNgn: 160_000 }),
    ).rejects.toThrow(/fiat commit/i)

    const saga = await conversionSagaStore.getByDepositId('dep-fiatfail')
    expect(saga?.state).toBe('failed')
    expect(fiat.commits).toHaveLength(0)
    expect(chain.submitCalls).toBe(0) // never started
  })

  it('chain-ok / receipt-fail (queued) -> forward recovery, no double mint', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    chain.mode = 'queue' // submitted but not confirmed (receipt write pending)
    const svc = makeService(fiat, chain)

    const first = await svc.convert({
      depositId: 'dep-recovery',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })

    expect(first.state).toBe('onchain_submitted')
    expect(fiat.commits).toHaveLength(1)
    expect(chain.submitCalls).toBe(1)

    // Forward recovery: re-run. The submit-onchain step replays (idempotent),
    // so no second submission / no double mint.
    const recovered = await svc.execute(first)
    expect(recovered.state).toBe('onchain_submitted')
    expect(chain.submitCalls).toBe(1) // NOT re-submitted
    expect(fiat.commits).toHaveLength(1) // NOT re-debited
  })

  it('rate-expired -> execution rejected', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    // Lock a quote that has already expired by the time we execute.
    const svc = makeService(fiat, chain, { rateLockTtlMs: -1 })

    const saga = await svc.lockQuote({
      depositId: 'dep-expired',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })

    await expect(svc.execute(saga)).rejects.toThrow(/expired/i)
    expect(fiat.commits).toHaveLength(0)
    expect(chain.submitCalls).toBe(0)
  })

  it('retry storm: many concurrent convert() calls -> single debit, single mint', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    chain.mode = 'confirm'
    const svc = makeService(fiat, chain)

    const input = { depositId: 'dep-storm', userId: 'u1', kind: 'deposit' as const, amountNgn: 160_000 }

    const results = await Promise.allSettled(Array.from({ length: 12 }, () => svc.convert(input)))

    // Some concurrent attempts may bounce off the in-flight idempotency lease;
    // at least one must complete, and side effects must not duplicate.
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled.length).toBeGreaterThan(0)

    const saga = await conversionSagaStore.getByDepositId('dep-storm')
    expect(saga?.state).toBe('completed')
    expect(fiat.commits).toHaveLength(1) // exactly one debit
    expect(chain.submitCalls).toBe(1) // exactly one mint
    expect(fiat.refunds).toHaveLength(0)
  })

  it('sequential retries after completion are replay-safe no-ops', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    chain.mode = 'confirm'
    const svc = makeService(fiat, chain)
    const input = { depositId: 'dep-replay', userId: 'u1', kind: 'deposit' as const, amountNgn: 160_000 }

    const a = await svc.convert(input)
    const b = await svc.convert(input)
    const c = await svc.convert(input)

    expect(a.sagaId).toBe(b.sagaId)
    expect(b.sagaId).toBe(c.sagaId)
    expect(a.state).toBe('completed')
    expect(c.state).toBe('completed')
    expect(fiat.commits).toHaveLength(1)
    expect(chain.submitCalls).toBe(1)
  })

  it('locked rate is preserved on re-lock (recovery uses original price)', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    const svc = makeService(fiat, chain)

    const first = await svc.lockQuote({
      depositId: 'dep-lock',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })
    expect(first.lockedRate).toBe(RATE)

    // Re-locking the same deposit must return the SAME locked rate/saga, even
    // though a fresh quote could differ.
    const second = await svc.lockQuote({
      depositId: 'dep-lock',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })
    expect(second.sagaId).toBe(first.sagaId)
    expect(second.lockedRate).toBe(first.lockedRate)
    expect(second.rateExpiresAt.getTime()).toBe(first.rateExpiresAt.getTime())
  })

  it('compensation is idempotent: re-running does not double-refund', async () => {
    const fiat = new FakeFiatLeg()
    const chain = new FakeOnchainLeg()
    chain.mode = 'throw'
    const svc = makeService(fiat, chain)

    const saga = await svc.convert({
      depositId: 'dep-comp-idem',
      userId: 'u1',
      kind: 'deposit',
      amountNgn: 160_000,
    })
    expect(saga.state).toBe('compensated')
    expect(fiat.refunds).toHaveLength(1)

    // Re-run compensation explicitly — must be a no-op.
    const again = await svc.compensate(saga, 'retry')
    expect(again.state).toBe('compensated')
    expect(fiat.refunds).toHaveLength(1) // not doubled
  })
})
