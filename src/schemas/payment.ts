import { z } from 'zod'

/**
 * Schema for payment confirmation request
 */
export const confirmPaymentSchema = z.object({
  externalRef: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/, 'Must be in format "source:id"')
    .describe('External payment reference in format "source:id"'),
  dealId: z.string().min(1).describe('Deal ID for the receipt'),
  amount: z.string().regex(/^\d+$/, 'Must be a positive integer string').describe('Payment amount'),
  payer: z.string().min(1).describe('Payer address'),
})

export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentSchema>
