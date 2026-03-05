import { RewardsDataLayer, RewardRecord, PayoutStatus } from './earnings.js'

/**
 * In-memory stub implementation of RewardsDataLayer for testing and development.
 * Provides deterministic test data based on whistleblower ID.
 */
export class StubRewardsDataLayer implements RewardsDataLayer {
  private rewards: Map<string, RewardRecord[]> = new Map()

  constructor() {
    console.log('🔧 Using StubRewardsDataLayer - no real database calls will be made')
    this.seedTestData()
  }

  async getRewardsByWhistleblower(whistleblowerId: string): Promise<RewardRecord[]> {
    const rewards = this.rewards.get(whistleblowerId) || []
    console.log(`[Stub] getRewardsByWhistleblower(${whistleblowerId}) -> ${rewards.length} rewards`)
    return rewards
  }

  async whistleblowerExists(whistleblowerId: string): Promise<boolean> {
    const exists = this.rewards.has(whistleblowerId)
    console.log(`[Stub] whistleblowerExists(${whistleblowerId}) -> ${exists}`)
    return exists
  }

  /**
   * Seed some test data for development.
   */
  private seedTestData(): void {
    // Test whistleblower with mixed status rewards
    const testWhistleblowerId = 'test-whistleblower-1'
    this.rewards.set(testWhistleblowerId, [
      {
        id: 'reward-1',
        whistleblowerId: testWhistleblowerId,
        listingId: 'listing-1',
        dealId: 'deal-1',
        amountUsdc: 50_000_000n, // 50 USDC
        status: 'paid' as PayoutStatus,
        createdAt: new Date('2024-01-15T10:00:00Z'),
        paidAt: new Date('2024-01-20T14:30:00Z'),
      },
      {
        id: 'reward-2',
        whistleblowerId: testWhistleblowerId,
        listingId: 'listing-2',
        dealId: 'deal-2',
        amountUsdc: 100_000_000n, // 100 USDC
        status: 'pending' as PayoutStatus,
        createdAt: new Date('2024-02-01T08:00:00Z'),
        paidAt: null,
      },
      {
        id: 'reward-3',
        whistleblowerId: testWhistleblowerId,
        listingId: 'listing-3',
        dealId: 'deal-3',
        amountUsdc: 75_000_000n, // 75 USDC
        status: 'payable' as PayoutStatus,
        createdAt: new Date('2024-02-10T12:00:00Z'),
        paidAt: null,
      },
      {
        id: 'reward-4',
        whistleblowerId: testWhistleblowerId,
        listingId: 'listing-4',
        dealId: 'deal-4',
        amountUsdc: 25_000_000n, // 25 USDC
        status: 'paid' as PayoutStatus,
        createdAt: new Date('2024-01-10T16:00:00Z'),
        paidAt: new Date('2024-01-15T10:00:00Z'),
      },
    ])

    // Test whistleblower with no rewards
    this.rewards.set('test-whistleblower-empty', [])

    // Test whistleblower with only pending rewards
    this.rewards.set('test-whistleblower-pending', [
      {
        id: 'reward-5',
        whistleblowerId: 'test-whistleblower-pending',
        listingId: 'listing-5',
        dealId: 'deal-5',
        amountUsdc: 30_000_000n, // 30 USDC
        status: 'pending' as PayoutStatus,
        createdAt: new Date('2024-03-01T09:00:00Z'),
        paidAt: null,
      },
    ])
  }

  /**
   * Helper method to add rewards for testing (not part of the interface).
   */
  addReward(reward: RewardRecord): void {
    const existing = this.rewards.get(reward.whistleblowerId) || []
    this.rewards.set(reward.whistleblowerId, [...existing, reward])
  }

  /**
   * Helper method to clear all rewards for testing (not part of the interface).
   */
  clearRewards(): void {
    this.rewards.clear()
  }
}
