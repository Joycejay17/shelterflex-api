import { EarningsResponse, EarningsTotals, EarningsHistoryItem } from '../schemas/whistleblower.js'
import { notFound, internalError } from '../errors/AppError.js'

/**
 * Internal data model representing a reward record from the data layer.
 */
export interface RewardRecord {
  id: string
  whistleblowerId: string
  listingId: string
  dealId: string
  amountUsdc: bigint
  status: PayoutStatus
  createdAt: Date
  paidAt: Date | null
}

export type PayoutStatus = 'pending' | 'payable' | 'paid'

/**
 * Data layer interface for querying reward records.
 * This abstracts the underlying storage mechanism (database, smart contract, etc.)
 */
export interface RewardsDataLayer {
  getRewardsByWhistleblower(whistleblowerId: string): Promise<RewardRecord[]>
  whistleblowerExists(whistleblowerId: string): Promise<boolean>
}

/**
 * Service interface for earnings business logic.
 */
export interface EarningsService {
  getEarnings(whistleblowerId: string): Promise<EarningsResponse>
}

/**
 * Configuration for the earnings service.
 */
export interface EarningsServiceConfig {
  usdcToNgnRate: number
}

/**
 * Implementation of the earnings service with aggregation and currency conversion logic.
 */
export class EarningsServiceImpl implements EarningsService {
  constructor(
    private readonly dataLayer: RewardsDataLayer,
    private readonly config: EarningsServiceConfig,
  ) {}

  async getEarnings(whistleblowerId: string): Promise<EarningsResponse> {
    try {
      // Check if whistleblower exists
      const exists = await this.dataLayer.whistleblowerExists(whistleblowerId)
      if (!exists) {
        throw notFound('Whistleblower')
      }

      // Query rewards from data layer
      const rewards = await this.dataLayer.getRewardsByWhistleblower(whistleblowerId)

      // Calculate aggregated totals
      const totals = this.calculateTotals(rewards)

      // Format and sort history
      const history = this.formatHistory(rewards)

      return {
        totals,
        history,
      }
    } catch (error) {
      // Re-throw AppError instances
      if (error instanceof Error && error.name === 'AppError') {
        throw error
      }

      // Wrap unexpected errors
      console.error('Error retrieving earnings:', error)
      throw internalError('Failed to retrieve earnings data')
    }
  }

  /**
   * Convert USDC amount (bigint in smallest unit) to NGN decimal.
   * USDC has 6 decimal places, so 1 USDC = 1_000_000 units.
   */
  private convertUsdcToNgn(usdcAmount: bigint): number {
    const usdcDecimal = Number(usdcAmount) / 1_000_000
    return usdcDecimal * this.config.usdcToNgnRate
  }

  /**
   * Convert USDC amount (bigint in smallest unit) to decimal USDC.
   */
  private convertUsdcToDecimal(usdcAmount: bigint): number {
    return Number(usdcAmount) / 1_000_000
  }

  /**
   * Calculate aggregated totals from reward records.
   * Implements requirements 2.2, 2.3, 2.4, 2.5.
   */
  private calculateTotals(rewards: RewardRecord[]): EarningsTotals {
    // Calculate USDC totals
    const totalUsdc = rewards.reduce((sum, r) => sum + r.amountUsdc, 0n)
    const pendingUsdc = rewards
      .filter((r) => r.status === 'pending' || r.status === 'payable')
      .reduce((sum, r) => sum + r.amountUsdc, 0n)
    const paidUsdc = rewards
      .filter((r) => r.status === 'paid')
      .reduce((sum, r) => sum + r.amountUsdc, 0n)

    // Convert to NGN
    const totalNgn = this.convertUsdcToNgn(totalUsdc)
    const pendingNgn = this.convertUsdcToNgn(pendingUsdc)
    const paidNgn = this.convertUsdcToNgn(paidUsdc)

    return {
      totalNgn,
      pendingNgn,
      paidNgn,
      totalUsdc: this.convertUsdcToDecimal(totalUsdc),
      pendingUsdc: this.convertUsdcToDecimal(pendingUsdc),
      paidUsdc: this.convertUsdcToDecimal(paidUsdc),
    }
  }

  /**
   * Format reward records into history items and sort by createdAt descending.
   * Implements requirements 3.1, 3.2, 3.3, 3.4, 3.5.
   */
  private formatHistory(rewards: RewardRecord[]): EarningsHistoryItem[] {
    // Sort by createdAt descending (most recent first)
    const sortedRewards = [...rewards].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return sortedRewards.map((reward) => {
      const item: EarningsHistoryItem = {
        rewardId: reward.id,
        listingId: reward.listingId,
        dealId: reward.dealId,
        amountNgn: this.convertUsdcToNgn(reward.amountUsdc),
        amountUsdc: this.convertUsdcToDecimal(reward.amountUsdc),
        status: reward.status,
        createdAt: reward.createdAt.toISOString(),
      }

      // Include paidAt only when status is paid
      if (reward.status === 'paid' && reward.paidAt) {
        item.paidAt = reward.paidAt.toISOString()
      }

      return item
    })
  }
}
