/**
 * Underwriting configuration.
 *
 * Centralises tunable risk thresholds so they can be changed via environment
 * variables without code changes (see issue #908). Currently holds the
 * rent-to-income (RTI) thresholds used by the RTI assessment engine.
 */

export interface RtiThresholds {
  /** RTI percent at or below this is a clean pass. */
  passMaxPercent: number
  /** RTI percent above passMax and at or below this is borderline (manual review). */
  borderlineMaxPercent: number
}

export const DEFAULT_RTI_THRESHOLDS: RtiThresholds = {
  passMaxPercent: 35,
  borderlineMaxPercent: 45,
}

function readPercent(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

/**
 * Resolve the active RTI thresholds, allowing environment overrides:
 *   RTI_PASS_MAX_PERCENT       (default 35)
 *   RTI_BORDERLINE_MAX_PERCENT (default 45)
 */
export function getRtiThresholds(): RtiThresholds {
  const passMaxPercent = readPercent('RTI_PASS_MAX_PERCENT', DEFAULT_RTI_THRESHOLDS.passMaxPercent)
  const borderlineMaxPercent = readPercent(
    'RTI_BORDERLINE_MAX_PERCENT',
    DEFAULT_RTI_THRESHOLDS.borderlineMaxPercent,
  )
  // Borderline ceiling must sit above the pass ceiling to be meaningful.
  if (borderlineMaxPercent <= passMaxPercent) {
    return { passMaxPercent, borderlineMaxPercent: passMaxPercent }
  }
  return { passMaxPercent, borderlineMaxPercent }
}
