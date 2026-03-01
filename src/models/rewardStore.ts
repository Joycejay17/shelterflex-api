import { randomUUID } from 'node:crypto'
import { Reward, RewardStatus, CreateRewardInput } from './reward.js'

/**
 * In-memory reward store
 * MVP implementation - designed for easy database migration
 */
class RewardStore {
  private rewards = new Map<string, Reward>()

  /**
   * Create a new reward
   */
  async create(input: CreateRewardInput): Promise<Reward> {
    const now = new Date()
    const reward: Reward = {
      rewardId: randomUUID(),
      whistleblowerId: input.whistleblowerId,
      dealId: input.dealId,
      listingId: input.listingId,
      amountUsdc: input.amountUsdc,
      status: RewardStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    }

    this.rewards.set(reward.rewardId, reward)
    return reward
  }

  /**
   * Get reward by ID
   */
  async getById(rewardId: string): Promise<Reward | null> {
    return this.rewards.get(rewardId) ?? null
  }

  /**
   * Update reward status to paid
   */
  async markAsPaid(
    rewardId: string,
    paymentTxId: string,
    externalRefSource: string,
    externalRef: string,
    metadata?: {
      amountNgn?: number
      fxRateNgnPerUsdc?: number
      fxProvider?: string
    },
  ): Promise<Reward | null> {
    const reward = this.rewards.get(rewardId)
    if (!reward) return null

    reward.status = RewardStatus.PAID
    reward.paidAt = new Date()
    reward.updatedAt = new Date()
    reward.paymentTxId = paymentTxId
    reward.externalRefSource = externalRefSource
    reward.externalRef = externalRef
    
    if (metadata) {
      reward.metadata = metadata
    }

    this.rewards.set(rewardId, reward)
    return reward
  }

  /**
   * Update reward status
   */
  async updateStatus(rewardId: string, status: RewardStatus): Promise<Reward | null> {
    const reward = this.rewards.get(rewardId)
    if (!reward) return null

    reward.status = status
    reward.updatedAt = new Date()

    this.rewards.set(rewardId, reward)
    return reward
  }

  /**
   * List all rewards
   */
  async listAll(): Promise<Reward[]> {
    return Array.from(this.rewards.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.rewards.clear()
  }
}

// Singleton instance
export const rewardStore = new RewardStore()
