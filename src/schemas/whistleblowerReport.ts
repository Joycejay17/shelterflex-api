import { z } from 'zod'

export const createReportSchema = z.object({
  reportType: z.enum(['fake_listing', 'fraudulent_landlord', 'rent_scam', 'other']),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  evidenceUrl: z.string().url('Invalid URL').optional(),
  contactEmail: z.string().email('Invalid email').optional(),
})

export const updateReportStatusSchema = z.object({
  status: z.enum(['under_investigation', 'resolved', 'dismissed']),
  note: z.string().min(1, 'Note is required'),
})

export const listReportsQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type CreateReportInput = z.infer<typeof createReportSchema>
export type UpdateReportStatusInput = z.infer<typeof updateReportStatusSchema>
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>
