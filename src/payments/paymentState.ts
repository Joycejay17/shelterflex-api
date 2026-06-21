import type { InternalPaymentStatus } from './types.js'

const STATUS_PRECEDENCE: Record<InternalPaymentStatus, number> = {
  pending: 0,
  failed: 1,
  confirmed: 2,
  reversed: 3,
}

/**
 * Payment state is a join-semilattice: applying the same set of events in any
 * order converges on the highest-precedence state. In particular, reversal is
 * terminal and stale pending/failed events cannot overwrite confirmation.
 */
export function monotonicPaymentStatus(
  current: InternalPaymentStatus,
  incoming: InternalPaymentStatus,
): InternalPaymentStatus {
  return STATUS_PRECEDENCE[incoming] > STATUS_PRECEDENCE[current]
    ? incoming
    : current
}

export function canAdvancePaymentStatus(
  current: InternalPaymentStatus,
  incoming: InternalPaymentStatus,
): boolean {
  return monotonicPaymentStatus(current, incoming) !== current
}

