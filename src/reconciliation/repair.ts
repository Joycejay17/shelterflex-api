/**
 * Idempotent repair execution for reconciliation auto-resolution.
 *
 * A `missing_credit` repair posts the missing credit. The resolver retries an
 * open mismatch on every pass until it succeeds or hits `maxResolutionAttempts`,
 * and the worker fires passes on a fixed interval with no overlap guard — so two
 * passes can run concurrently and hit the same open mismatch. Without care that
 * double-credits the user, the exact failure this is meant to prevent.
 *
 * `applyIdempotentRepair` keys each repair by a deterministic, mismatch-derived
 * key and runs the effect **at most once per key**, including under concurrency:
 *   - a completed key short-circuits (TTL-bounded `applied` cache);
 *   - an in-flight key makes concurrent callers await the *same* promise instead
 *     of launching a second effect (`inFlight` map);
 *   - a failed effect is recorded nowhere, so a genuine transient failure can
 *     still be retried.
 *
 * In-process today (models the invariant and proves it under test). The durable
 * cross-process guarantee is a DB unique constraint on `repairKey`; that row can
 * reuse the same key. The `applied` cache is bounded by size and TTL so a
 * long-running worker cannot grow it without limit.
 */

import { LRUCache } from 'lru-cache'
import type { Mismatch } from './types.js'

const APPLIED_TTL_MS = 24 * 60 * 60 * 1000 // ≥ longest missing_credit SLA (24h)

// Completed repairs: bounded so a long-running worker cannot leak memory. TTL is
// far longer than any retry/escalation window, so a key never expires while its
// mismatch could still be retried.
const applied = new LRUCache<string, true>({ max: 50_000, ttl: APPLIED_TTL_MS })

// Repairs currently executing, so concurrent callers coalesce onto one effect.
const inFlight = new Map<string, Promise<void>>()

/**
 * Deterministic repair key for a mismatch. Stable across retries and process
 * restarts: derived from the class plus the strongest available identity
 * (ledger event id, else internal ref, else mismatch id).
 */
export function repairKey(mismatch: Mismatch): string {
  const ref =
    mismatch.ledgerEventId ??
    (mismatch.traceContext.internalRef as string | undefined) ??
    mismatch.id
  return `${mismatch.mismatchClass}:${ref}`
}

export interface RepairOutcome {
  /** true if the effect ran on this call; false if it was already applied or coalesced. */
  applied: boolean
  key: string
}

/**
 * Run `effect` at most once for `key`, even when called concurrently. The first
 * caller runs the effect; callers that arrive while it is in flight await the
 * same promise; callers after it completed short-circuit. If `effect` throws,
 * the key is not recorded so the repair can be retried.
 */
export async function applyIdempotentRepair(
  key: string,
  effect: () => Promise<void>,
): Promise<RepairOutcome> {
  if (applied.has(key)) return { applied: false, key }

  const existing = inFlight.get(key)
  if (existing) {
    await existing
    return { applied: false, key }
  }

  // Start the effect and register it *before* awaiting, so a concurrent caller
  // observes the in-flight promise rather than starting a second effect.
  const run = effect()
  inFlight.set(key, run)
  try {
    await run
    applied.set(key, true)
    return { applied: true, key }
  } finally {
    inFlight.delete(key)
  }
}

/** True if a repair for this key has already been applied (and not yet expired). */
export function hasRepairBeenApplied(key: string): boolean {
  return applied.has(key)
}

/** Test hook: clear all recorded and in-flight repair keys. */
export function resetRepairs(): void {
  applied.clear()
  inFlight.clear()
}
