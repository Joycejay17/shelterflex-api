/**
 * Heuristic bank statement analysis (no third-party API).
 */

import type { BankStatementLine } from '../models/tenantOnboardingDataStore.js'

const NSF_PATTERN = /\b(NSF|non[- ]?sufficient|returned item|returned check|insufficient funds|bounced)\b/i
const INCOME_CREDIT_PATTERN = /\b(salary|payroll|wages|transfer in|credit|deposit)\b/i

export interface BankStatementAnalysis {
  averageMonthlyBalance: number
  incomeCreditCount: number
  incomeRegularityScore: number
  debtObligationScore: number
  nsfCount: number
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function analyzeBankStatement(lines: BankStatementLine[]): BankStatementAnalysis {
  if (lines.length === 0) {
    return {
      averageMonthlyBalance: 0,
      incomeCreditCount: 0,
      incomeRegularityScore: 0,
      debtObligationScore: 50,
      nsfCount: 0,
    }
  }

  let runningBalance = 0
  const monthlyBalances = new Map<string, number>()
  const monthlyIncomeCredits = new Map<string, number>()
  let incomeCreditCount = 0
  let nsfCount = 0
  let recurringDebitCount = 0

  for (const line of lines) {
    if (NSF_PATTERN.test(line.description)) nsfCount += 1
    runningBalance += line.amount
    const key = monthKey(line.date)
    monthlyBalances.set(key, runningBalance)

    if (line.amount > 0 && INCOME_CREDIT_PATTERN.test(line.description)) {
      incomeCreditCount += 1
      monthlyIncomeCredits.set(key, (monthlyIncomeCredits.get(key) ?? 0) + line.amount)
    }
    if (line.amount < 0 && /\b(loan|emi|repayment|debit order)\b/i.test(line.description)) {
      recurringDebitCount += 1
    }
  }

  const balanceValues = [...monthlyBalances.values()]
  const averageMonthlyBalance =
    balanceValues.length > 0
      ? balanceValues.reduce((a, b) => a + b, 0) / balanceValues.length
      : 0

  const monthlyTotals = [...monthlyIncomeCredits.values()]
  let incomeRegularityScore = 50
  if (monthlyTotals.length >= 2) {
    const mean = monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length
    const variance =
      monthlyTotals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / monthlyTotals.length
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
    incomeRegularityScore = Math.round(Math.max(0, 100 - cv * 100))
  } else if (monthlyTotals.length === 1) {
    incomeRegularityScore = 70
  }

  const debtObligationScore = Math.max(0, 100 - recurringDebitCount * 15)

  return {
    averageMonthlyBalance,
    incomeCreditCount,
    incomeRegularityScore,
    debtObligationScore,
    nsfCount,
  }
}

export function bankStatementSubScore(analysis: BankStatementAnalysis): number {
  let score = 50
  if (analysis.incomeCreditCount >= 3) score += 15
  else if (analysis.incomeCreditCount >= 1) score += 8

  score += Math.min(20, analysis.incomeRegularityScore / 5)
  score += Math.min(15, analysis.debtObligationScore / 7)
  score -= analysis.nsfCount * 12
  if (analysis.averageMonthlyBalance > 0) score += 10

  return Math.max(0, Math.min(100, Math.round(score)))
}
