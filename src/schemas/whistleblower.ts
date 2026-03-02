import { z } from 'zod'

/**
 * Schema for whistleblower earnings endpoint validation.
 * Defines request parameters and response structures for the earnings API.
 */

// Path parameter validation
export const whistleblowerIdParamSchema = z.object({
  id: z.string().min(1, 'Whistleblower ID is required'),
})

export type WhistleblowerIdParam = z.infer<typeof whistleblowerIdParamSchema>

// Response schemas
export const earningsTotalsSchema = z.object({
  totalNgn: z.number(),
  pendingNgn: z.number(),
  paidNgn: z.number(),
  totalUsdc: z.number().optional(),
  pendingUsdc: z.number().optional(),
  paidUsdc: z.number().optional(),
})

export type EarningsTotals = z.infer<typeof earningsTotalsSchema>

export const earningsHistoryItemSchema = z.object({
  rewardId: z.string(),
  listingId: z.string(),
  dealId: z.string(),
  amountNgn: z.number(),
  amountUsdc: z.number(),
  status: z.enum(['pending', 'payable', 'paid']),
  createdAt: z.string(),
  paidAt: z.string().optional(),
})

export type EarningsHistoryItem = z.infer<typeof earningsHistoryItemSchema>

export const earningsResponseSchema = z.object({
  totals: earningsTotalsSchema,
  history: z.array(earningsHistoryItemSchema),
})

export type EarningsResponse = z.infer<typeof earningsResponseSchema>
