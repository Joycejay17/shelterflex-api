import { z } from 'zod'

export const personalInfoSchema = z.object({
  fullName: z.string().min(2),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().min(7),
  residentialAddress: z.string().min(5),
  nin: z.string().optional(),
  bvn: z.string().optional(),
})

export const employmentInfoSchema = z.object({
  employmentStatus: z.enum(['employed', 'self_employed', 'unemployed']),
  employerName: z.string().optional(),
  monthlyIncome: z.number().nonnegative().optional(),
  proofOfEmploymentType: z.string().optional(),
})

export const documentsSchema = z.object({
  bankStatementKey: z.string().optional(),
  proofOfIncomeKey: z.string().optional(),
  governmentIdKey: z.string().optional(),
})

export const walletInfoSchema = z.object({
  walletAddress: z.string().optional(),
  walletType: z.enum(['stellar', 'freighter']).optional(),
  skipped: z.boolean().default(false),
})

export const onboardingDraftSchema = z.object({
  personalInfo: personalInfoSchema.optional(),
  employmentInfo: employmentInfoSchema.optional(),
  documents: documentsSchema.optional(),
  walletInfo: walletInfoSchema.optional(),
})

export type PersonalInfo = z.infer<typeof personalInfoSchema>
export type EmploymentInfo = z.infer<typeof employmentInfoSchema>
export type Documents = z.infer<typeof documentsSchema>
export type WalletInfo = z.infer<typeof walletInfoSchema>
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>

export const ONBOARDING_STEPS = ['personal_info', 'employment_info', 'documents', 'wallet', 'summary'] as const
export type OnboardingStep = typeof ONBOARDING_STEPS[number]

export interface OnboardingRecord {
  id: string
  userId: string
  personalInfo: PersonalInfo | null
  employmentInfo: EmploymentInfo | null
  documents: Documents | null
  walletInfo: WalletInfo | null
  completedSteps: string[]
  currentStep: OnboardingStep
  submitted: boolean
  submittedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
