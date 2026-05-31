/**
 * Contract addresses for Soroban event indexing
 * These are the contract IDs to monitor for events
 */

export const CONTRACT_ADDRESSES = {
  // Add contract IDs as they are deployed
  // Example:
  // RENT_PAYMENTS: 'CD...',
  // DEAL_ESCROW: 'CD...',
  // REWARD_DISTRIBUTION: 'CD...',
  // WHISTLEBLOWER_VALIDATION: 'CD...',
  // STAKING_POOL: 'CD...',
} as const

export type ContractName = keyof typeof CONTRACT_ADDRESSES

export function getContractAddresses(): string[] {
  return Object.values(CONTRACT_ADDRESSES).filter((addr): addr is string => typeof addr === 'string' && addr.length > 0)
}
