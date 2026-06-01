/**
 * Repayment Schedule Service
 * Generates and manages deterministic installment calendars for deals
 */

import { v4 as uuidv4 } from 'uuid'
import { getPool, type PgPoolLike } from '../db.js'

export type RepaymentPlan = '3m' | '6m' | '12m' | 'outright'

export interface RepaymentScheduleItem {
  paymentNumber: number
  dueDate: Date
  principalAmountNgn: number // in kobo (integer)
  interestAmountNgn: number // in kobo (integer)
  totalAmountNgn: number // in kobo (integer)
  status: 'pending' | 'paid' | 'overdue' | 'waived'
  paidAt?: Date
}

export interface RepaymentScheduleInput {
  dealId: string
  startDate: Date
  plan: RepaymentPlan
  installmentBasePriceNgn: number // in NGN (will be converted to kobo)
  depositPct: number // percentage (e.g., 20 for 20%)
}

export interface RepaymentScheduleOutput {
  dealId: string
  schedule: RepaymentScheduleItem[]
  depositAmountNgn: number // in kobo
  financedBalanceNgn: number // in kobo
  interestAmountNgn: number // in kobo
  totalRepaymentNgn: number // in kobo
}

// Interest rates per plan (annual percentage)
const INTEREST_RATES: Record<RepaymentPlan, number> = {
  '3m': 0.08,    // 8%
  '6m': 0.12,    // 12%
  '12m': 0.15,   // 15%
  'outright': 0, // 0% interest for outright
}

/**
 * Generate a deterministic repayment schedule
 */
export function generateSchedule(input: RepaymentScheduleInput): RepaymentScheduleOutput {
  const { dealId, startDate, plan, installmentBasePriceNgn, depositPct } = input

  // Convert NGN to kobo (integer)
  const basePriceKobo = Math.round(installmentBasePriceNgn * 100)

  // Calculate deposit amount
  const depositAmountKobo = Math.round(basePriceKobo * (depositPct / 100))
  const financedBalanceKobo = basePriceKobo - depositAmountKobo

  // Handle outright plan (single payment, no interest, 7 days from start)
  if (plan === 'outright') {
    const dueDate = new Date(startDate)
    dueDate.setDate(dueDate.getDate() + 7)

    const schedule: RepaymentScheduleItem[] = [{
      paymentNumber: 1,
      dueDate,
      principalAmountNgn: financedBalanceKobo,
      interestAmountNgn: 0,
      totalAmountNgn: financedBalanceKobo,
      status: 'pending',
    }]

    return {
      dealId,
      schedule,
      depositAmountNgn: depositAmountKobo,
      financedBalanceNgn: financedBalanceKobo,
      interestAmountNgn: 0,
      totalRepaymentNgn: financedBalanceKobo,
    }
  }

  // Calculate interest for installment plans
  const annualRate = INTEREST_RATES[plan]
  const termMonths = parseInt(plan.replace('m', ''), 10)
  const interestAmountKobo = Math.round(financedBalanceKobo * annualRate * (termMonths / 12))
  const totalRepaymentKobo = financedBalanceKobo + interestAmountKobo

  // Calculate monthly installment amount
  const monthlyInstallmentKobo = Math.floor(totalRepaymentKobo / termMonths)

  // Generate schedule
  const schedule: RepaymentScheduleItem[] = []
  let totalAllocated = 0

  for (let i = 0; i < termMonths; i++) {
    const paymentNumber = i + 1
    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + paymentNumber)

    // Last payment absorbs rounding difference
    const isLastPayment = paymentNumber === termMonths
    const totalAmountKobo = isLastPayment 
      ? totalRepaymentKobo - totalAllocated 
      : monthlyInstallmentKobo

    totalAllocated += totalAmountKobo

    // Calculate principal and interest portions (proportional)
    const principalPortion = Math.round((totalAmountKobo * financedBalanceKobo) / totalRepaymentKobo)
    const interestPortion = totalAmountKobo - principalPortion

    schedule.push({
      paymentNumber,
      dueDate,
      principalAmountNgn: principalPortion,
      interestAmountNgn: interestPortion,
      totalAmountNgn: totalAmountKobo,
      status: 'pending',
    })
  }

  return {
    dealId,
    schedule,
    depositAmountNgn: depositAmountKobo,
    financedBalanceNgn: financedBalanceKobo,
    interestAmountNgn: interestAmountKobo,
    totalRepaymentNgn: totalRepaymentKobo,
  }
}

/**
 * Save schedule to database
 */
export async function saveSchedule(
  dealId: string,
  schedule: RepaymentScheduleItem[],
  depositAmountNgn: number,
  financedBalanceNgn: number,
  interestAmountNgn: number,
  totalRepaymentNgn: number
): Promise<void> {
  const pool = await getPool()
  if (!pool) {
    throw new Error('Database pool is not available')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Delete existing schedule for this deal (if any)
    await client.query(
      'DELETE FROM repayment_schedule WHERE deal_id = $1',
      [dealId]
    )

    // Insert schedule items
    for (const item of schedule) {
      await client.query(
        `INSERT INTO repayment_schedule (
          id, deal_id, payment_number, due_date, 
          principal_amount_ngn, interest_amount_ngn, total_amount_ngn, 
          status, paid_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv4(),
          dealId,
          item.paymentNumber,
          item.dueDate,
          item.principalAmountNgn,
          item.interestAmountNgn,
          item.totalAmountNgn,
          item.status,
          item.paidAt || null,
        ]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Get schedule from database with updated payment statuses
 */
export async function getSchedule(dealId: string): Promise<RepaymentScheduleOutput | null> {
  const pool = await getPool()
  if (!pool) {
    throw new Error('Database pool is not available')
  }

  const { rows } = await pool.query(
    `SELECT 
      payment_number, due_date, principal_amount_ngn, interest_amount_ngn, 
      total_amount_ngn, status, paid_at
     FROM repayment_schedule
     WHERE deal_id = $1
     ORDER BY payment_number ASC`,
    [dealId]
  )

  if (rows.length === 0) {
    return null
  }

  const schedule: RepaymentScheduleItem[] = rows.map((row: any) => ({
    paymentNumber: row.payment_number,
    dueDate: new Date(row.due_date),
    principalAmountNgn: parseInt(row.principal_amount_ngn),
    interestAmountNgn: parseInt(row.interest_amount_ngn),
    totalAmountNgn: parseInt(row.total_amount_ngn),
    status: row.status,
    paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
  }))

  // Calculate totals
  const depositAmountNgn = schedule.reduce((sum, item) => sum + item.principalAmountNgn, 0) * 0.2 // rough estimate
  const financedBalanceNgn = schedule.reduce((sum, item) => sum + item.principalAmountNgn, 0)
  const interestAmountNgn = schedule.reduce((sum, item) => sum + item.interestAmountNgn, 0)
  const totalRepaymentNgn = schedule.reduce((sum, item) => sum + item.totalAmountNgn, 0)

  return {
    dealId,
    schedule,
    depositAmountNgn: Math.round(depositAmountNgn),
    financedBalanceNgn,
    interestAmountNgn,
    totalRepaymentNgn,
  }
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(
  dealId: string,
  paymentNumber: number,
  status: 'pending' | 'paid' | 'overdue' | 'waived',
  paidAt?: Date
): Promise<void> {
  const pool = await getPool()
  if (!pool) {
    throw new Error('Database pool is not available')
  }

  await pool.query(
    `UPDATE repayment_schedule 
     SET status = $3, paid_at = $4 
     WHERE deal_id = $1 AND payment_number = $2`,
    [dealId, paymentNumber, status, paidAt || null]
  )
}
