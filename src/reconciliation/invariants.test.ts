import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classifyLedgerEvent, runReconciliationPass } from './engine.js'
import { runResolutionPass, setMissingCreditPoster } from './resolver.js'
import {
  tryAbsorbDrift,
  getDriftSnapshot,
  configureDrift,
  resetDrift,
} from './drift.js'
import { applyIdempotentRepair, hasRepairBeenApplied, resetRepairs, repairKey } from './repair.js'
import * as store from './store.js'
import type { LedgerEvent, ProviderEvent, Mismatch, ToleranceRule } from './types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const RULE: ToleranceRule = {
  rail: 'paystack',
  toleranceMinor: 100n,
  maxDelaySeconds: 3600,
  maxResolutionAttempts: 3,
}

function makeLedger(overrides: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: 'ledger-1',
    eventType: 'credit',
    amountMinor: 100_000n,
    currency: 'NGN',
    internalRef: 'ref-001',
    rail: 'paystack',
    status: 'pending',
    occurredAt: new Date('2026-01-01T10:00:00Z'),
    createdAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  }
}

function makeProvider(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    id: 'provider-1',
    provider: 'paystack',
    providerEventId: 'ps_evt_001',
    eventType: 'credit',
    amountMinor: 100_000n,
    currency: 'NGN',
    internalRef: 'ref-001',
    rawStatus: 'success',
    occurredAt: new Date('2026-01-01T10:00:30Z'),
    createdAt: new Date('2026-01-01T10:00:30Z'),
    ...overrides,
  }
}

function makeMismatch(overrides: Partial<Mismatch> = {}): Mismatch {
  return {
    id: 'm-1',
    mismatchClass: 'missing_credit',
    ledgerEventId: 'ledger-1',
    toleranceMinor: 100n,
    status: 'open',
    resolutionAttempts: 0,
    traceContext: { rail: 'paystack', internalRef: 'ref-001' },
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-01T10:00:00Z'),
    ...overrides,
  }
}

const NOW = new Date('2026-01-01T10:05:00Z').getTime()

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const out: T[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutations(rest)) out.push([item, ...p])
  })
  return out
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetDrift()
  resetRepairs()
  configureDrift({ windowMs: 3_600_000, capMinor: 100_000n })
})

// ── I1 / I4 — Convergence & deterministic classification ────────────────────────

describe('I1/I4 convergence & deterministic classification', () => {
  it('classifies identically for every ordering of the same provider events', () => {
    // latest (10:00:30, 100_000) is the settlement → clean match regardless of order
    const events = [
      makeProvider({ id: 'a', amountMinor: 90_000n, occurredAt: new Date('2026-01-01T09:59:00Z') }),
      makeProvider({ id: 'b', amountMinor: 100_000n, occurredAt: new Date('2026-01-01T10:00:30Z') }),
      makeProvider({ id: 'c', amountMinor: 95_000n, occurredAt: new Date('2026-01-01T09:58:00Z') }),
    ]
    const results = permutations(events).map(
      (order) => classifyLedgerEvent(makeLedger(), order, RULE, NOW).kind,
    )
    expect(new Set(results)).toEqual(new Set(['match']))
  })

  it('is order-independent when the latest event is the mismatching one', () => {
    const events = [
      makeProvider({ id: 'a', amountMinor: 100_000n, occurredAt: new Date('2026-01-01T09:59:00Z') }),
      makeProvider({ id: 'b', amountMinor: 1n, occurredAt: new Date('2026-01-01T10:00:30Z') }), // latest, way off
    ]
    for (const order of permutations(events)) {
      const r = classifyLedgerEvent(makeLedger(), order, RULE, NOW)
      expect(r.kind).toBe('mismatch')
      if (r.kind === 'mismatch') expect(r.mismatchClass).toBe('amount_mismatch')
    }
  })

  it('a pair converges to match whether the provider event is present or arrives later', () => {
    // ledger seen before provider exists, still within delay window → non-terminal skip
    const earlyLedger = makeLedger({ occurredAt: new Date(NOW - 60_000) })
    expect(classifyLedgerEvent(earlyLedger, [], RULE, NOW).kind).toBe('skip')
    // once the provider event exists, the same pair converges to match
    expect(classifyLedgerEvent(earlyLedger, [makeProvider()], RULE, NOW).kind).toBe('match')
  })

  it('a genuinely unmatched ledger event past the delay window is missing_credit', () => {
    const stale = makeLedger({ occurredAt: new Date(NOW - 7_200_000) }) // 2h, beyond 1h window
    const r = classifyLedgerEvent(stale, [], RULE, NOW)
    expect(r.kind).toBe('mismatch')
    if (r.kind === 'mismatch') expect(r.mismatchClass).toBe('missing_credit')
  })
})

// ── duplicate provider events ───────────────────────────────────────────────────

describe('duplicate provider events', () => {
  it('flags duplicate_debit for any ordering and count of duplicate debits', () => {
    const debits = [
      makeProvider({ id: 'd1', eventType: 'debit', occurredAt: new Date('2026-01-01T10:00:10Z') }),
      makeProvider({ id: 'd2', eventType: 'debit', occurredAt: new Date('2026-01-01T10:00:20Z') }),
      makeProvider({ id: 'd3', eventType: 'debit', occurredAt: new Date('2026-01-01T10:00:30Z') }),
    ]
    for (const order of permutations(debits)) {
      const r = classifyLedgerEvent(makeLedger({ eventType: 'debit' }), order, RULE, NOW)
      expect(r.kind === 'mismatch' && r.mismatchClass).toBe('duplicate_debit')
    }
  })

  it('does not treat a single debit among credits as a duplicate', () => {
    const events = [
      makeProvider({ id: 'c1', eventType: 'credit' }),
      makeProvider({ id: 'd1', eventType: 'debit' }),
    ]
    // single debit → not duplicate; latest event drives amount classification
    expect(classifyLedgerEvent(makeLedger(), events, RULE, NOW).kind).not.toBe('mismatch')
  })
})

// ── near-tolerance-boundary amounts ─────────────────────────────────────────────

describe('near-tolerance-boundary amounts', () => {
  it('treats a diff exactly equal to tolerance as a within-tolerance match', () => {
    const r = classifyLedgerEvent(makeLedger(), [makeProvider({ amountMinor: 99_900n })], RULE, NOW)
    expect(r.kind).toBe('match')
    if (r.kind === 'match') expect(r.absorbedMinor).toBe(100n)
  })

  it('treats one minor unit beyond tolerance as amount_mismatch', () => {
    const r = classifyLedgerEvent(makeLedger(), [makeProvider({ amountMinor: 99_899n })], RULE, NOW)
    expect(r.kind === 'mismatch' && r.mismatchClass).toBe('amount_mismatch')
  })

  it('records zero absorbed drift for an exact match', () => {
    const r = classifyLedgerEvent(makeLedger(), [makeProvider()], RULE, NOW)
    expect(r.kind === 'match' && r.absorbedMinor).toBe(0n)
  })
})

// ── I2 — bounded, observable drift ──────────────────────────────────────────────

describe('I2 bounded drift accounting', () => {
  it('sums absorption per window and refuses once the cap is reached', () => {
    configureDrift({ windowMs: 3_600_000, capMinor: 100n })
    expect(tryAbsorbDrift('paystack', 'NGN', 60n, NOW)).toBe(true)
    expect(tryAbsorbDrift('paystack', 'NGN', 60n, NOW)).toBe(false) // 120 > 100
    const snap = getDriftSnapshot(NOW)
    expect(snap.totalAbsorbedMinor).toBe(60n)
    expect(snap.totalAbsorbedMinor <= snap.capMinor).toBe(true)
  })

  it('never lets a zero difference move the meter', () => {
    expect(tryAbsorbDrift('paystack', 'NGN', 0n, NOW)).toBe(true)
    expect(getDriftSnapshot(NOW).totalAbsorbedMinor).toBe(0n)
  })

  it('resets absorption after the window rolls over', () => {
    configureDrift({ windowMs: 1_000, capMinor: 100n })
    expect(tryAbsorbDrift('paystack', 'NGN', 80n, NOW)).toBe(true)
    expect(tryAbsorbDrift('paystack', 'NGN', 80n, NOW)).toBe(false)
    expect(tryAbsorbDrift('paystack', 'NGN', 80n, NOW + 2_000)).toBe(true) // new window
  })

  it('keeps separate budgets per rail:currency bucket', () => {
    configureDrift({ windowMs: 3_600_000, capMinor: 100n })
    expect(tryAbsorbDrift('paystack', 'NGN', 100n, NOW)).toBe(true)
    expect(tryAbsorbDrift('flutterwave', 'NGN', 100n, NOW)).toBe(true)
    expect(tryAbsorbDrift('paystack', 'NGN', 1n, NOW)).toBe(false)
  })

  it('escalates a within-tolerance match to amount_mismatch once the engine cap is breached', async () => {
    configureDrift({ windowMs: 10_000_000, capMinor: 100n })
    const ledgers = [
      makeLedger({ id: 'l1', internalRef: 'r1' }),
      makeLedger({ id: 'l2', internalRef: 'r2' }),
      makeLedger({ id: 'l3', internalRef: 'r3' }),
    ]
    vi.spyOn(store, 'listPendingLedgerEvents').mockResolvedValue(ledgers)
    vi.spyOn(store, 'findProviderEventByRef').mockImplementation(async (ref) =>
      makeProvider({ internalRef: ref, amountMinor: 99_950n }), // 50 within tolerance each
    )
    vi.spyOn(store, 'listProviderEventsByRef').mockImplementation(async (ref) => [
      makeProvider({ internalRef: ref, amountMinor: 99_950n }),
    ])
    const persist = vi.spyOn(store, 'persistMismatch').mockResolvedValue({} as never)
    vi.spyOn(store, 'markLedgerEventStatus').mockResolvedValue()

    const result = await runReconciliationPass([RULE])

    // 50 + 50 absorbed (cap 100); the third (would be 150) is refused and escalates
    expect(result.matched).toBe(2)
    expect(result.mismatches).toBe(1)
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchClass: 'amount_mismatch',
        traceContext: expect.objectContaining({ driftCapBreached: true }),
      }),
    )
  })
})

// ── I3 — no double-repair (idempotency) ─────────────────────────────────────────

describe('I3 idempotent repair', () => {
  it('runs the repair effect at most once per key', async () => {
    let calls = 0
    const effect = async () => {
      calls++
    }
    const first = await applyIdempotentRepair('missing_credit:ref-001', effect)
    const second = await applyIdempotentRepair('missing_credit:ref-001', effect)
    expect(first.applied).toBe(true)
    expect(second.applied).toBe(false)
    expect(calls).toBe(1)
  })

  it('does not record the key when the effect throws, allowing a later retry', async () => {
    const key = 'missing_credit:ref-throw'
    await expect(
      applyIdempotentRepair(key, async () => {
        throw new Error('transient PSP failure')
      }),
    ).rejects.toThrow('transient PSP failure')
    expect(hasRepairBeenApplied(key)).toBe(false)

    let posted = 0
    const ok = await applyIdempotentRepair(key, async () => {
      posted++
    })
    expect(ok.applied).toBe(true)
    expect(posted).toBe(1)
  })

  it('coalesces concurrent repairs of the same key onto a single effect', async () => {
    // Two passes overlapping (the worker has no overlap guard) must not both run
    // the effect. Hold the effect open so both calls are in flight at once.
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const effect = async () => {
      calls++
      await gate
    }

    const p1 = applyIdempotentRepair('missing_credit:concurrent', effect)
    const p2 = applyIdempotentRepair('missing_credit:concurrent', effect)
    release()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(calls).toBe(1)
    expect([r1.applied, r2.applied].sort()).toEqual([false, true])
  })

  it('does not double-credit missing_credit under a resolution-pass retry storm', async () => {
    const mismatch = makeMismatch({ mismatchClass: 'missing_credit', resolutionAttempts: 0 })
    let credited = 0
    setMissingCreditPoster(async () => {
      credited++
    })
    vi.spyOn(store, 'listMismatches').mockResolvedValue([mismatch])
    const update = vi.spyOn(store, 'updateMismatchStatus').mockResolvedValue()
    vi.spyOn(store, 'listOpenMismatchesPastSla').mockResolvedValue([])

    for (let i = 0; i < 5; i++) await runResolutionPass()

    expect(credited).toBe(1)
    expect(hasRepairBeenApplied(repairKey(mismatch))).toBe(true)
    // A confirmed repair resolves the mismatch — it is not left to escalate.
    expect(update).toHaveBeenCalledWith('m-1', 'auto_resolved', expect.objectContaining({}))
  })
})

// ── I5 — SLA escalation, never silent auto-resolve ──────────────────────────────

describe('I5 SLA escalation', () => {
  it('escalates open mismatches past their SLA deadline regardless of attempt count', async () => {
    const overdue = makeMismatch({
      id: 'm-overdue',
      mismatchClass: 'amount_mismatch',
      resolutionAttempts: 0,
      slaDeadline: new Date(NOW - 1_000),
    })
    vi.spyOn(store, 'listMismatches').mockResolvedValue([])
    vi.spyOn(store, 'listOpenMismatchesPastSla').mockResolvedValue([overdue])
    const update = vi.spyOn(store, 'updateMismatchStatus').mockResolvedValue()

    const result = await runResolutionPass()

    expect(result.escalated).toBe(1)
    expect(update).toHaveBeenCalledWith('m-overdue', 'escalated', expect.objectContaining({}))
  })

  it('escalates a mismatch that has exhausted its resolution attempts', async () => {
    const exhausted = makeMismatch({
      id: 'm-exhausted',
      mismatchClass: 'missing_credit',
      resolutionAttempts: 3, // == paystack maxResolutionAttempts
    })
    let credited = 0
    setMissingCreditPoster(async () => {
      credited++
    })
    vi.spyOn(store, 'listMismatches').mockResolvedValue([exhausted])
    vi.spyOn(store, 'listOpenMismatchesPastSla').mockResolvedValue([])
    const update = vi.spyOn(store, 'updateMismatchStatus').mockResolvedValue()

    const result = await runResolutionPass()

    expect(result.escalated).toBe(1)
    expect(credited).toBe(0) // handler not run once attempts are exhausted
    expect(update).toHaveBeenCalledWith('m-exhausted', 'escalated', expect.objectContaining({}))
  })
})
