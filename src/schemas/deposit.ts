import { z } from 'zod'

export const depositInitiateSchema = z.object({
  quoteId: z.string().min(1),
  paymentRail: z.string().min(1),
  customerMeta: z
    .object({
      name: z.string().min(1).optional(),
      phone: z.string().min(1).optional(),
    })
    .optional(),
})

export type DepositInitiateRequest = z.infer<typeof depositInitiateSchema>

export const paymentsWebhookSchema = z.object({
  externalRefSource: z.string().min(1),
  externalRef: z.string().min(1),
  status: z.enum(['confirmed', 'failed']).default('confirmed'),
})

export type PaymentsWebhookRequest = z.infer<typeof paymentsWebhookSchema>
