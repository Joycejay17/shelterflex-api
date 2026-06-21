/**
 * Bounded-drift accounting for the reconciliation engine.
 *
 * Tolerance rules let the engine treat a small ledger/provider amount difference
 * as a clean match instead of flagging an `amount_mismatch`. Evaluated *per
 * event* that is safe, but it is also exactly how systematic drift hides: a rail
 * that is consistently 50 minor units short on every settlement looks fine
 * event-by-event while quietly leaking money in aggregate.
 *
 * This accountant makes absorption **summed and capped, not per-event**
 * (issue #1101):
 *   - it sums every absorbed difference within a rolling window, per
 *     `rail:currency` bucket;
 *   - once the window total would exceed `capMinor`, `tryAbsorbDrift` refuses,
 *     so the caller escalates the mismatch instead of silently absorbing it;
 *   - the running total is exact (bigint) and observable via `getDriftSnapshot`
 *     and the `reconciliation_tolerance_absorbed_minor_total` metric.
 *
 * The state is in-process: it bounds drift within a worker window and feeds the
 * alerting metric. Cross-process/durable enforcement is the DB's job and is out
 * of scope here (the issue scopes this as hardening of the existing engine).
 */

import { recordToleranceAbsorbed, recordDriftCapBreach } from '../metrics.js'

export interface DriftConfig {
  /** Rolling window length in milliseconds. */
  windowMs: number
  /** Max minor units that may be absorbed by tolerance per bucket per window. */
  capMinor: bigint
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw != null ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function envBigint(name: string, fallback: bigint): bigint {
  const raw = process.env[name]
  if (raw == null) return fallback
  try {
    const v = BigInt(raw)
    return v >= 0n ? v : fallback
  } catch {
    return fallback
  }
}

let config: DriftConfig = {
  windowMs: envInt('RECON_DRIFT_WINDOW_MS', 3_600_000), // 1 hour
  capMinor: envBigint('RECON_DRIFT_CAP_MINOR', 100_000n),
}

interface Bucket {
  windowStart: number
  absorbedMinor: bigint
}

const buckets = new Map<string, Bucket>()

function bucketKey(rail: string, currency: string): string {
  return `${rail}:${currency}`
}

function rolled(bucket: Bucket, nowMs: number): Bucket {
  if (nowMs - bucket.windowStart >= config.windowMs) {
    bucket.windowStart = nowMs
    bucket.absorbedMinor = 0n
  }
  return bucket
}

/**
 * Attempt to absorb `amountMinor` of drift for a `rail:currency` bucket.
 *
 * Returns `true` if the amount fits under the windowed cap (and records it), or
 * `false` if absorbing it would breach the cap — in which case nothing is
 * recorded and the caller must escalate the mismatch. A zero difference is
 * always absorbable and never moves the meter.
 */
export function tryAbsorbDrift(
  rail: string,
  currency: string,
  amountMinor: bigint,
  nowMs: number = Date.now(),
): boolean {
  if (amountMinor <= 0n) return true

  const key = bucketKey(rail, currency)
  const bucket = rolled(buckets.get(key) ?? { windowStart: nowMs, absorbedMinor: 0n }, nowMs)
  buckets.set(key, bucket)

  if (bucket.absorbedMinor + amountMinor > config.capMinor) {
    recordDriftCapBreach(rail, currency)
    return false
  }

  bucket.absorbedMinor += amountMinor
  recordToleranceAbsorbed(rail, currency, Number(amountMinor))
  return true
}

export interface DriftBucketSnapshot {
  rail: string
  currency: string
  windowStart: string
  absorbedMinor: bigint
  capMinor: bigint
  utilizationPct: number
}

export interface DriftSnapshot {
  windowMs: number
  capMinor: bigint
  totalAbsorbedMinor: bigint
  buckets: DriftBucketSnapshot[]
}

/** Exact, inspectable view of current absorption — for tests, ops, and alerting. */
export function getDriftSnapshot(nowMs: number = Date.now()): DriftSnapshot {
  let total = 0n
  const out: DriftBucketSnapshot[] = []
  for (const [key, raw] of buckets) {
    const bucket = rolled(raw, nowMs)
    const [rail, currency] = key.split(':')
    total += bucket.absorbedMinor
    out.push({
      rail,
      currency,
      windowStart: new Date(bucket.windowStart).toISOString(),
      absorbedMinor: bucket.absorbedMinor,
      capMinor: config.capMinor,
      utilizationPct:
        config.capMinor > 0n
          ? Math.round((Number(bucket.absorbedMinor) / Number(config.capMinor)) * 10000) / 100
          : 0,
    })
  }
  return { windowMs: config.windowMs, capMinor: config.capMinor, totalAbsorbedMinor: total, buckets: out }
}

/** Test/ops hook: override the window and cap. */
export function configureDrift(partial: Partial<DriftConfig>): void {
  config = { ...config, ...partial }
}

/** Test hook: clear all accumulated drift state. */
export function resetDrift(): void {
  buckets.clear()
}
