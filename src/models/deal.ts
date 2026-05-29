/**
 * Deal model and types for ShelterFlex financing
 */

export enum DealStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  AT_RISK = 'at_risk',
  COMPLETED = 'completed',
  DEFAULTED = 'defaulted',
}

export enum ScheduleItemStatus {
  UPCOMING = 'upcoming',
  DUE = 'due',
  PAID = 'paid',
  LATE = 'late',
}

export type RepaymentMethod = 'self_pay' | 'salary_deduction'

export interface Deal {
  dealId: string
  tenantId: string
  landlordId: string
  listingId?: string
  annualRentNgn: number
  depositNgn: number
  financedAmountNgn: number
  termMonths: number
  createdAt: Date
  status: DealStatus
  repaymentMethod: RepaymentMethod
  employerId?: string
  employeeId?: string
  deductionDay?: number
}

export interface CreateDealInput {
  tenantId: string
  landlordId: string
  listingId?: string
  annualRentNgn: number
  depositNgn: number
  termMonths: number
  repaymentMethod?: RepaymentMethod
  employerId?: string
  employeeId?: string
  deductionDay?: number
}

export interface ScheduleItem {
  period: number
  dueDate: string // ISO string
  amountNgn: number
  status: ScheduleItemStatus
}

export interface DealWithSchedule extends Deal {
  schedule: ScheduleItem[]
}

export interface DealFilters {
  tenantId?: string
  landlordId?: string
  status?: DealStatus
  page?: number
  pageSize?: number
}

export interface PaginatedDeals {
  deals: Deal[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
