import { z } from 'zod'

const bankStatementLineSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1).max(500),
  amount: z.number(),
})

const mobileMoneyTxSchema = z.object({
  date: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(['credit', 'debit']),
})

export const submitTenantOnboardingSchema = z.object({
  applicationId: z.string().min(1).max(128),
  statedMonthlyIncome: z.number().positive(),
  monthlyRent: z.number().positive(),
  employmentStatus: z.string().min(1).max(64),
  employerName: z.string().max(256),
  employmentProofText: z.string().max(10000).optional(),
  bankStatementLines: z.array(bankStatementLineSchema).min(1).max(500),
  mobileMoneyTransactions: z.array(mobileMoneyTxSchema).max(500).optional(),
})

export type SubmitTenantOnboardingRequest = z.infer<typeof submitTenantOnboardingSchema>
