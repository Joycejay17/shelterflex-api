/**
 * Builds TenantRiskProfile from onboarding verification data.
 */

import { tenantOnboardingDataStore } from '../models/tenantOnboardingDataStore.js'
import { analyzeBankStatement } from './bankStatementAnalysis.js'
import type { TenantRiskProfile } from './aiRiskScoreProvider.js'

function employmentTenureMonths(status: string): number {
  const s = status.toLowerCase()
  if (s === 'unemployed' || s === 'none') return 0
  if (s === 'self_employed') return 12
  if (s === 'employed') return 24
  return 6
}

function estimateMonthlyDebtObligations(
  recurringDebitCount: number,
  averageMonthlyBalance: number,
): number {
  if (recurringDebitCount <= 0) return 0
  const perDebit = averageMonthlyBalance > 0 ? averageMonthlyBalance * 0.05 : 15_000
  return Math.round(recurringDebitCount * perDebit)
}

export function buildTenantRiskProfile(tenantId: string): TenantRiskProfile | undefined {
  const data = tenantOnboardingDataStore.findByTenantId(tenantId)
  if (!data) return undefined

  const monthlyIncome = data.statedMonthlyIncome
  const incomeToRentRatio =
    data.monthlyRent > 0 ? monthlyIncome / data.monthlyRent : 0

  const analysis = analyzeBankStatement(data.bankStatementLines)
  const recurringDebitPattern = /\b(loan|emi|repayment|debit order)\b/i
  let recurringDebitCount = 0
  for (const line of data.bankStatementLines) {
    if (line.amount < 0 && recurringDebitPattern.test(line.description)) {
      recurringDebitCount += 1
    }
  }

  return {
    tenantId,
    dataVersion: data.dataVersion,
    monthlyIncome,
    incomeToRentRatio,
    employmentTenureMonths: employmentTenureMonths(data.employmentStatus),
    bankMetrics: {
      averageBalance: analysis.averageMonthlyBalance,
      nsfCount: analysis.nsfCount,
      incomeRegularity: analysis.incomeRegularityScore,
    },
    existingDebtObligations: estimateMonthlyDebtObligations(
      recurringDebitCount,
      analysis.averageMonthlyBalance,
    ),
  }
}
