/**
 * Reward model and types
 */

export enum RewardStatus {
  PENDING = 'pending',
  PAYABLE = 'payable',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export interface Reward {
  rewardId: string
  whistleblowerId: string
  dealId: string
  listingId: string
  amountUsdc: number
  status: RewardStatus
  createdAt: Date
  updatedAt: Date
  paidAt?: Date
  paymentTxId?: string
  externalRefSource?: string
  externalRef?: string
  metadata?: {
    amountNgn?: number
    fxRateNgnPerUsdc?: number
    fxProvider?: string
  }
}

export interface CreateRewardInput {
  whistleblowerId: string
  dealId: string
  listingId: string
  amountUsdc: number
}

export interface MarkRewardPaidInput {
  amountUsdc: number
  tokenAddress: string
  externalRefSource: string
  externalRef: string
  amountNgn?: number
  fxRateNgnPerUsdc?: number
  fxProvider?: string
}
