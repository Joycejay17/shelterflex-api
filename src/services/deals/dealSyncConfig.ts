/**
 * Returns true when on-chain deal status sync should run.
 */
export function isDealSyncEnabled(): boolean {
  return process.env.DEAL_SYNC_ENABLED === 'true'
}

/**
 * Map backend deal status to on-chain sync target (draft/at_risk are not synced).
 */
export function mapDealStatusToSyncTarget(
  status: string,
): 'active' | 'completed' | 'defaulted' | null {
  switch (status) {
    case 'active':
      return 'active'
    case 'completed':
      return 'completed'
    case 'defaulted':
      return 'defaulted'
    default:
      return null
  }
}
