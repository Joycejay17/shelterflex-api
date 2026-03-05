import { z } from 'zod'

export const depositProviderSchema = z.enum(['onramp', 'offramp', 'manual_admin'])

export const confirmDepositSchema = z.object({
  depositId: z.string().min(1).describe('Canonical deposit identifier: {provider}:{id}'),
  userId: z.string().min(1).describe('User ID that owns this deposit'),
  amountNgn: z.number().positive().describe('Confirmed deposit amount in NGN'),
  provider: depositProviderSchema.describe('Deposit source / liquidity route'),
  providerRef: z.string().min(1).describe('Provider-specific reference for reconciliation'),
})

export type ConfirmDepositRequest = z.infer<typeof confirmDepositSchema>
