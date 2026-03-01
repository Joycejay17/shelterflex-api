import { z } from 'zod'

/**
 * Schema for marking a reward as paid
 */
export const markRewardPaidSchema = z.object({
  amountUsdc: z
    .number()
    .positive('Amount must be greater than 0')
    .describe('Payment amount in USDC'),
  tokenAddress: z
    .string()
    .min(1, 'Token address is required')
    .describe('USDC token contract address'),
  externalRefSource: z
    .string()
    .min(1, 'External reference source is required')
    .describe('Source of external reference (e.g., "stripe", "manual")'),
  externalRef: z
    .string()
    .min(1, 'External reference is required')
    .describe('External payment reference ID'),
  amountNgn: z
    .number()
    .positive()
    .optional()
    .describe('Optional payment amount in Nigerian Naira'),
  fxRateNgnPerUsdc: z
    .number()
    .positive()
    .optional()
    .describe('Optional FX rate (NGN per USDC)'),
  fxProvider: z
    .string()
    .optional()
    .describe('Optional FX rate provider'),
})

export type MarkRewardPaidRequest = z.infer<typeof markRewardPaidSchema>
