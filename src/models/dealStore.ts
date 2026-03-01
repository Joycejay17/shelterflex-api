/**
 * In-memory store for Deal management (MVP)
 * Following the same pattern as listingStore.ts
 */

import { randomUUID } from 'node:crypto'
import { 
  Deal, 
  CreateDealInput, 
  DealWithSchedule, 
  ScheduleItem, 
  DealFilters, 
  PaginatedDeals,
  DealStatus,
  ScheduleItemStatus 
} from './deal.js'
import { generateRepaymentSchedule } from '../utils/scheduleGenerator.js'

export interface StoredDeal extends Deal {
  schedule: ScheduleItem[]
}

class DealStore {
  private deals: Map<string, StoredDeal> = new Map()

  async create(input: CreateDealInput): Promise<DealWithSchedule> {
    // Validate business rules
    this.validateCreateInput(input)

    const dealId = randomUUID()
    const now = new Date()
    
    const schedule = generateRepaymentSchedule({
      annualRentNgn: input.annualRentNgn,
      depositNgn: input.depositNgn,
      termMonths: input.termMonths,
      startDate: now
    })

    const deal: StoredDeal = {
      dealId,
      tenantId: input.tenantId,
      landlordId: input.landlordId,
      listingId: input.listingId,
      annualRentNgn: input.annualRentNgn,
      depositNgn: input.depositNgn,
      financedAmountNgn: input.annualRentNgn - input.depositNgn,
      termMonths: input.termMonths,
      createdAt: now,
      status: DealStatus.DRAFT,
      schedule
    }

    this.deals.set(dealId, deal)

    return {
      ...deal,
      schedule: [...schedule]
    }
  }

  async findById(dealId: string): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    return {
      ...deal,
      schedule: [...deal.schedule]
    }
  }

  async findMany(filters: DealFilters = {}): Promise<PaginatedDeals> {
    let filteredDeals = Array.from(this.deals.values())

    // Apply filters
    if (filters.tenantId) {
      filteredDeals = filteredDeals.filter(deal => deal.tenantId === filters.tenantId)
    }
    if (filters.landlordId) {
      filteredDeals = filteredDeals.filter(deal => deal.landlordId === filters.landlordId)
    }
    if (filters.status) {
      filteredDeals = filteredDeals.filter(deal => deal.status === filters.status)
    }

    // Sort by createdAt descending
    filteredDeals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Pagination
    const page = filters.page || 1
    const pageSize = filters.pageSize || 20
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize

    const paginatedDeals = filteredDeals.slice(startIndex, endIndex)

    return {
      deals: paginatedDeals.map(deal => ({
        dealId: deal.dealId,
        tenantId: deal.tenantId,
        landlordId: deal.landlordId,
        listingId: deal.listingId,
        annualRentNgn: deal.annualRentNgn,
        depositNgn: deal.depositNgn,
        financedAmountNgn: deal.financedAmountNgn,
        termMonths: deal.termMonths,
        createdAt: deal.createdAt,
        status: deal.status
      })),
      total: filteredDeals.length,
      page,
      pageSize,
      totalPages: Math.ceil(filteredDeals.length / pageSize)
    }
  }

  async updateStatus(dealId: string, status: DealStatus): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    deal.status = status

    return {
      ...deal,
      schedule: [...deal.schedule]
    }
  }

  async updateScheduleItemStatus(
    dealId: string, 
    period: number, 
    status: ScheduleItemStatus
  ): Promise<DealWithSchedule | null> {
    const deal = this.deals.get(dealId)
    if (!deal) return null

    const scheduleItem = deal.schedule.find(item => item.period === period)
    if (!scheduleItem) return null

    scheduleItem.status = status

    return {
      ...deal,
      schedule: [...deal.schedule]
    }
  }

  private validateCreateInput(input: CreateDealInput): void {
    if (input.annualRentNgn <= 0) {
      throw new Error('Annual rent must be greater than 0')
    }

    if (input.depositNgn < input.annualRentNgn * 0.2) {
      throw new Error('Deposit must be at least 20% of annual rent')
    }

    const allowedTerms = [3, 6, 12] // Configurable - move to config later
    if (!allowedTerms.includes(input.termMonths)) {
      throw new Error(`Term months must be one of: ${allowedTerms.join(', ')}`)
    }

    if (input.depositNgn >= input.annualRentNgn) {
      throw new Error('Deposit must be less than annual rent')
    }
  }

  // Helper method for testing
  async clear(): Promise<void> {
    this.deals.clear()
  }

  // Helper method to get all deals (for testing)
  async getAll(): Promise<StoredDeal[]> {
    return Array.from(this.deals.values())
  }
}

export const dealStore = new DealStore()
