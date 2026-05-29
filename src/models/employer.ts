/**
 * Employer partnership model for salary-deducted rent plans.
 */

export type EmployerStatus = 'pending' | 'active' | 'suspended'

export interface Employer {
  id: string
  name: string
  registrationNumber: string
  contactEmail: string
  contactPhone: string
  status: EmployerStatus
  /** SHA-256 hex hash of the plain API key */
  apiKeyHash: string
  monthlyDeductionWebhookUrl?: string
  verifiedAt?: Date
  createdAt: Date
}

export interface CreateEmployerInput {
  name: string
  registrationNumber: string
  contactEmail: string
  contactPhone: string
  monthlyDeductionWebhookUrl?: string
}

export interface EmployerPublicView {
  id: string
  name: string
  registrationNumber: string
  contactEmail: string
  contactPhone: string
  status: EmployerStatus
  monthlyDeductionWebhookUrl?: string
  verifiedAt?: string
  createdAt: string
}

export interface SalaryDeductionInstruction {
  dealId: string
  employerId: string
  employeeId: string
  deductionAmount: number
  deductionDay: number
  createdAt: Date
}

export interface CreateSalaryDeductionInstructionInput {
  dealId: string
  employerId: string
  employeeId: string
  deductionAmount: number
  deductionDay: number
}
