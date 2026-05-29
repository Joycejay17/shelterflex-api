/**
 * In-memory store for tenant onboarding / verification payloads used by credit scoring.
 */

import { createHash } from 'node:crypto'

export interface BankStatementLine {
  date: string
  description: string
  amount: number
}

export interface MobileMoneyTransaction {
  date: string
  amount: number
  type: 'credit' | 'debit'
}

export interface TenantOnboardingData {
  tenantId: string
  statedMonthlyIncome: number
  monthlyRent: number
  employmentStatus: string
  employerName: string
  employmentProofText?: string
  bankStatementLines: BankStatementLine[]
  mobileMoneyTransactions?: MobileMoneyTransaction[]
  dataVersion: number
  updatedAt: Date
}

class TenantOnboardingDataStore {
  private byTenant = new Map<string, TenantOnboardingData>()

  upsert(
    tenantId: string,
    data: Omit<TenantOnboardingData, 'tenantId' | 'dataVersion' | 'updatedAt'>,
  ): TenantOnboardingData {
    const existing = this.byTenant.get(tenantId)
    const dataVersion = (existing?.dataVersion ?? 0) + 1
    const record: TenantOnboardingData = {
      tenantId,
      ...data,
      dataVersion,
      updatedAt: new Date(),
    }
    this.byTenant.set(tenantId, record)
    return record
  }

  findByTenantId(tenantId: string): TenantOnboardingData | undefined {
    return this.byTenant.get(tenantId)
  }

  /** Stable hash for idempotent score recomputation. */
  dataVersionHash(tenantId: string, scoringConfigVersion: string): string {
    const data = this.byTenant.get(tenantId)
    if (!data) return 'no-data'
    const payload = JSON.stringify({
      dataVersion: data.dataVersion,
      statedMonthlyIncome: data.statedMonthlyIncome,
      monthlyRent: data.monthlyRent,
      employmentStatus: data.employmentStatus,
      employerName: data.employerName,
      employmentProofText: data.employmentProofText ?? '',
      bankLineCount: data.bankStatementLines.length,
      bankLines: data.bankStatementLines,
      mobileCount: data.mobileMoneyTransactions?.length ?? 0,
      mobile: data.mobileMoneyTransactions,
      scoringConfigVersion,
    })
    return createHash('sha256').update(payload).digest('hex').slice(0, 16)
  }

  clear(): void {
    this.byTenant.clear()
  }
}

export const tenantOnboardingDataStore = new TenantOnboardingDataStore()
