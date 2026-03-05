import { z } from 'zod'
import { TxType } from '../outbox/types.js'

/**
 * Schema for payment confirmation request.
 * On-chain accounting is standardized in USDC. NGN values are metadata only.
 */
export const confirmPaymentSchema = z.object({
  dealId: z.string().min(1).describe('Deal ID for this payment'),
  txType: z
    .nativeEnum(TxType)
    .refine(
      (v) =>
        v === TxType.TENANT_REPAYMENT ||
        v === TxType.LANDLORD_PAYOUT ||
        v === TxType.WHISTLEBLOWER_REWARD,
      { message: 'txType must be TENANT_REPAYMENT, LANDLORD_PAYOUT, or WHISTLEBLOWER_REWARD' },
    )
    .describe('Transaction type'),
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'Must be a positive decimal with up to 6 places (USDC is canonical)')
    .describe('Payment amount in USDC (canonical unit)'),
  tokenAddress: z.string().min(1).describe('USDC token contract address'),
  externalRefSource: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with underscores/hyphens only')
    .describe('Payment provider source identifier (e.g., stripe, manual, stellar)'),
  externalRef: z
    .string()
    .min(1)
    .describe('Provider-specific payment reference string'),
  // Optional NGN metadata
  amountNgn: z.number().positive().optional().describe('Payment amount in NGN (metadata only)'),
  fxRateNgnPerUsdc: z.number().positive().optional().describe('FX rate NGN per USDC at time of payment'),
  fxProvider: z.string().min(1).optional().describe('FX rate provider name'),
})

export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentSchema>
