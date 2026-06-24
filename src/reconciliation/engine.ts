import { logger } from '../utils/logger.js'
import {
  listPendingLedgerEvents,
  markLedgerEventStatus,
  findProviderEventByRef,
  listProviderEventsByRef,
  persistMismatch,
} from './store.js'
import type { LedgerEvent, ProviderEvent, ToleranceRule, MismatchClass } from './types.js'
import { DEFAULT_TOLERANCE_RULES } from './types.js'
import { tryAbsorbDrift } from './drift.js'
import { recordReconciliationMismatch } from '../metrics.js'

export type ReconciliationResult = {
  matched: number
  mismatches: number
  skipped: number
}

function getRule(rail: string, rules: ToleranceRule[]): ToleranceRule {
  return rules.find((r) => r.rail === rail) ?? {
    rail,
    toleranceMinor: 0n,
    maxDelaySeconds: 3600,
    maxResolutionAttempts: 3,
  }
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a
}

/**
 * Deterministically pick the settlement provider event from a set sharing an
 * internal ref: the latest by `occurredAt`, breaking ties by id. Pure and
 * order-independent, so classification does not depend on arrival/query order
 * (issue #1101 — deterministic class assignment).
 */
function pickSettlement(events: ProviderEvent[]): ProviderEvent {
  return events.reduce((best, e) => {
    const t = e.occurredAt.getTime()
    const bt = best.occurredAt.getTime()
    if (t > bt) return e
    if (t === bt && e.id > best.id) return e
    return best
  })
}

// ── Pure classifier ─────────────────────────────────────────────────────────

export type ClassifyResult =
  | { kind: 'skip' }
  | { kind: 'match'; settlement: ProviderEvent; absorbedMinor: bigint }
  | {
      kind: 'mismatch'
      mismatchClass: MismatchClass
      settlement?: ProviderEvent
      markLedgerAs: LedgerEvent['status']
    }

/**
 * Classify one ledger event against the provider events sharing its internal
 * ref. A *pure, deterministic* function of its inputs — the same inputs in any
 * order yield the same result — so the engine's terminal state is independent of
 * event arrival/interleaving. The caller performs the side effects.
 *
 * Evaluation order (first match wins): missing credit → duplicate debit →
 * amount mismatch → delayed settlement → clean/within-tolerance match.
 */
export function classifyLedgerEvent(
  ledger: LedgerEvent,
  providerEvents: ProviderEvent[],
  rule: ToleranceRule,
  nowMs: number,
): ClassifyResult {
  // 1. No PSP settlement event yet for this ref.
  if (providerEvents.length === 0) {
    const ageMs = nowMs - ledger.occurredAt.getTime()
    if (ageMs > rule.maxDelaySeconds * 1000) {
      return { kind: 'mismatch', mismatchClass: 'missing_credit', markLedgerAs: 'unmatched' }
    }
    return { kind: 'skip' } // still within the delay window
  }

  const settlement = pickSettlement(providerEvents)

  // 2. Duplicate debit (more than one debit provider event for the ref).
  if (providerEvents.filter((e) => e.eventType === 'debit').length > 1) {
    return { kind: 'mismatch', mismatchClass: 'duplicate_debit', settlement, markLedgerAs: 'unmatched' }
  }

  // 3. Amount difference beyond tolerance.
  if (absDiff(ledger.amountMinor, settlement.amountMinor) > rule.toleranceMinor) {
    return { kind: 'mismatch', mismatchClass: 'amount_mismatch', settlement, markLedgerAs: 'unmatched' }
  }

  // 4. Delayed settlement — matched on amount but arrived past the delay window.
  const lateMs = Math.abs(settlement.occurredAt.getTime() - ledger.occurredAt.getTime())
  if (lateMs > rule.maxDelaySeconds * 1000) {
    return { kind: 'mismatch', mismatchClass: 'delayed_settlement', settlement, markLedgerAs: 'matched' }
  }

  // 5. Clean or within-tolerance match. absorbedMinor is the drift the tolerance
  //    rule would swallow (0 for an exact match) — the engine meters it.
  return { kind: 'match', settlement, absorbedMinor: absDiff(ledger.amountMinor, settlement.amountMinor) }
}

// ── Core matching (side effects) ────────────────────────────────────────────

async function reconcileLedgerEvent(
  ledger: LedgerEvent,
  rules: ToleranceRule[],
): Promise<'matched' | 'mismatch' | 'skipped'> {
  const rule = getRule(ledger.rail, rules)
  const trace = { internalRef: ledger.internalRef, rail: ledger.rail, ledgerEventId: ledger.id }
  const now = Date.now()

  // Preserve the original store-access shape: probe for a settlement first, only
  // pull the full set (for duplicate detection) when one exists.
  const settlement = await findProviderEventByRef(ledger.internalRef)
  let providerEvents: ProviderEvent[] = []
  if (settlement) {
    providerEvents = await listProviderEventsByRef(ledger.internalRef)
    if (providerEvents.length === 0) providerEvents = [settlement]
  }

  const decision = classifyLedgerEvent(ledger, providerEvents, rule, now)

  switch (decision.kind) {
    case 'skip':
      return 'skipped'

    case 'match': {
      // Tolerance absorption is summed and capped per window, not per event: if
      // absorbing this drift would breach the cap, escalate instead of silently
      // swallowing it (bounded, observable drift).
      if (decision.absorbedMinor > 0n) {
        const absorbed = tryAbsorbDrift(ledger.rail, ledger.currency, decision.absorbedMinor, now)
        if (!absorbed) {
          await persistMismatch({
            mismatchClass: 'amount_mismatch',
            ledgerEventId: ledger.id,
            providerEventId: decision.settlement.id,
            toleranceMinor: rule.toleranceMinor,
            expectedAmountMinor: ledger.amountMinor,
            actualAmountMinor: decision.settlement.amountMinor,
            traceContext: {
              ...trace,
              driftCapBreached: true,
              absorbedMinor: decision.absorbedMinor.toString(),
            },
          })
          await markLedgerEventStatus(ledger.id, 'unmatched')
          logger.warn('[reconciliation] Tolerance drift cap breached — escalating', trace)
          return 'mismatch'
        }
      }
      await markLedgerEventStatus(ledger.id, 'matched')
      logger.info('[reconciliation] Ledger event matched', trace)
      return 'matched'
    }

    case 'mismatch': {
      switch (decision.mismatchClass) {
        case 'missing_credit':
          await persistMismatch({
            mismatchClass: 'missing_credit',
            ledgerEventId: ledger.id,
            toleranceMinor: rule.toleranceMinor,
            expectedAmountMinor: ledger.amountMinor,
            traceContext: { ...trace, ageMs: now - ledger.occurredAt.getTime() },
          })
          await markLedgerEventStatus(ledger.id, 'unmatched')
          recordReconciliationMismatch('missing_credit')
          logger.warn('[reconciliation] Missing credit detected', trace)
          break

        case 'duplicate_debit':
          await persistMismatch({
            mismatchClass: 'duplicate_debit',
            ledgerEventId: ledger.id,
            providerEventId: decision.settlement!.id,
            toleranceMinor: rule.toleranceMinor,
            expectedAmountMinor: ledger.amountMinor,
            actualAmountMinor: decision.settlement!.amountMinor,
            traceContext: { ...trace, duplicateCount: providerEvents.length },
          })
          await markLedgerEventStatus(ledger.id, 'unmatched')
          recordReconciliationMismatch('duplicate_debit')
          logger.warn('[reconciliation] Duplicate debit detected', trace)
          break

        case 'amount_mismatch':
          await persistMismatch({
            mismatchClass: 'amount_mismatch',
            ledgerEventId: ledger.id,
            providerEventId: decision.settlement!.id,
            toleranceMinor: rule.toleranceMinor,
            expectedAmountMinor: ledger.amountMinor,
            actualAmountMinor: decision.settlement!.amountMinor,
            traceContext: trace,
          })
          await markLedgerEventStatus(ledger.id, 'unmatched')
          recordReconciliationMismatch('amount_mismatch')
          logger.warn('[reconciliation] Amount mismatch detected', {
            ...trace,
            expected: ledger.amountMinor.toString(),
            actual: decision.settlement!.amountMinor.toString(),
          })
          break

        case 'delayed_settlement':
          await persistMismatch({
            mismatchClass: 'delayed_settlement',
            ledgerEventId: ledger.id,
            providerEventId: decision.settlement!.id,
            toleranceMinor: rule.toleranceMinor,
            expectedAmountMinor: ledger.amountMinor,
            actualAmountMinor: decision.settlement!.amountMinor,
            traceContext: {
              ...trace,
              ledgerOccurredAt: ledger.occurredAt.toISOString(),
              providerOccurredAt: decision.settlement!.occurredAt.toISOString(),
            },
          })
          // Delayed settlement still matches on amount — mark matched.
          await markLedgerEventStatus(ledger.id, 'matched')
          recordReconciliationMismatch('delayed_settlement')
          logger.warn('[reconciliation] Delayed settlement detected', trace)
          break
      }
      return 'mismatch'
    }
  }
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function runReconciliationPass(
  rules: ToleranceRule[] = DEFAULT_TOLERANCE_RULES,
  batchSize = 200,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { matched: 0, mismatches: 0, skipped: 0 }

  const pendingEvents = await listPendingLedgerEvents(batchSize)
  logger.info('[reconciliation] Starting pass', { count: pendingEvents.length })

  for (const event of pendingEvents) {
    try {
      const outcome = await reconcileLedgerEvent(event, rules)
      if (outcome === 'matched') result.matched++
      else if (outcome === 'mismatch') result.mismatches++
      else result.skipped++
    } catch (err) {
      logger.error('[reconciliation] Error reconciling event', {
        ledgerEventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      })
      result.skipped++
    }
  }

  logger.info('[reconciliation] Pass complete', result)
  return result
}
