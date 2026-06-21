/**
 * Idempotent repair execution for reconciliation auto-resolution.
 *
 * A `missing_credit` repair posts the missing credit. The resolver retries an
 * open mismatch on every pass until it succeeds or hits `maxResolutionAttempts`,
 * so the repair side effect can be invoked many times for one mismatch ("repair
 * retry storm"). Without a guard, that double-credits the user — the exact
 * failure the issue calls out.
 *
 * `applyIdempotentRepair` keys each repair by a deterministic, mismatch-derived
 * key and runs the effect **at most once per key**: the first successful run
 * records the key, every later call for the same key is a no-op. A failed effect
 * does not record the key, so a genuine transient failure can still be retried.
 *
 * In-process today (models the invariant and proves it under test). The durable
 * version persists the key with a unique constraint; `repairKey` is exported so
 * that DB row can reuse the same key.
 */

import type { Mismatch } from './types.js'

const applied = new Set<string>()

/**
 * Deterministic repair key for a mismatch. Stable across retries and process
 * restarts: derived from the class plus the strongest available identity
 * (ledger event id, else internal ref, else mismatch id).
 */
export function repairKey(mismatch: Mismatch): string {
  const ref =
    mismatch.ledgerEventId ??
    (mismatch.traceContext?.internalRef as string | undefined) ??
    mismatch.id
  return `${mismatch.mismatchClass}:${ref}`
}

export interface RepairOutcome {
  /** true if the effect ran on this call; false if it was already applied. */
  applied: boolean
  key: string
}

/**
 * Run `effect` at most once for `key`. If already applied, returns without
 * re-running. If `effect` throws, the key is NOT recorded so the repair can be
 * retried.
 */
export async function applyIdempotentRepair(
  key: string,
  effect: () => Promise<void>,
): Promise<RepairOutcome> {
  if (applied.has(key)) return { applied: false, key }
  await effect()
  applied.add(key)
  return { applied: true, key }
}

/** True if a repair for this key has already been applied. */
export function hasRepairBeenApplied(key: string): boolean {
  return applied.has(key)
}

/** Test hook: clear all recorded repair keys. */
export function resetRepairs(): void {
  applied.clear()
}
