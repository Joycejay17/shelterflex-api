import { z } from 'zod'

export const applyReferralCodeSchema = z.object({
  referralCode: z.string().length(8, 'Referral code must be 8 characters'),
})

export const referralStatsQuerySchema = z.object({
  tenantId: z.string().optional(),
})

export type ApplyReferralCode = z.infer<typeof applyReferralCodeSchema>

export interface ReferralCode {
  id: string
  tenantId: string
  code: string
  createdAt: string
}

export interface ReferralConversion {
  id: string
  referralCodeId: string
  referrerTenantId: string
  referredTenantId: string
  dealId: string | null
  rewardAmountNgn: number
  status: 'pending' | 'credited' | 'applied' | 'cancelled'
  createdAt: string
  updatedAt: string
}

export interface ReferralStats {
  code: string
  referralLink: string
  totalReferred: number
  pendingRewards: number
  appliedRewards: number
  totalRewardAmountNgn: number
}

export interface AdminReferralView {
  id: string
  referrerCode: string
  referrerEmail: string
  referredEmail: string
  dealId: string | null
  rewardAmountNgn: number
  status: string
  createdAt: string
}
