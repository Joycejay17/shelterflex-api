import { z } from 'zod'

export const createEmployerSchema = z.object({
  name: z.string().min(1).max(256),
  registrationNumber: z.string().min(1).max(128),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(1).max(32),
  monthlyDeductionWebhookUrl: z.string().url().optional(),
})

export const employerListQuerySchema = z.object({
  status: z.enum(['pending', 'active', 'suspended']).optional(),
})

export const employerSearchQuerySchema = z.object({
  name: z.string().optional(),
})

export const deductionNotifySchema = z.object({
  employeeId: z.string().min(1).max(128),
  amount: z.number().positive(),
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
  referenceId: z.string().min(1).max(256),
})

export const updateDealRepaymentSchema = z.object({
  repaymentMethod: z.enum(['self_pay', 'salary_deduction']),
  employerId: z.string().uuid().optional(),
  employeeId: z.string().min(1).max(128).optional(),
  deductionDay: z.number().int().min(1).max(28).optional(),
}).superRefine((data, ctx) => {
  if (data.repaymentMethod === 'salary_deduction') {
    if (!data.employerId) {
      ctx.addIssue({ code: 'custom', message: 'employerId is required for salary deduction', path: ['employerId'] })
    }
    if (!data.employeeId) {
      ctx.addIssue({ code: 'custom', message: 'employeeId is required for salary deduction', path: ['employeeId'] })
    }
    if (!data.deductionDay) {
      ctx.addIssue({ code: 'custom', message: 'deductionDay is required for salary deduction', path: ['deductionDay'] })
    }
  }
})
