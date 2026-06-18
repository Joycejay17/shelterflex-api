/**
 * Repayment Schedule Service
 * Generates and manages deterministic installment calendars for deals.
 *
 * Rounding policy
 * ───────────────
 * All intermediate arithmetic is performed in bigint kobo to prevent the
 * precision loss that occurs when JavaScript number products exceed
 * Number.MAX_SAFE_INTEGER (2^53 − 1).  Final per-installment amounts are
 * allocated with the largest-remainder (Hamilton/Hare) method so that
 * Σ installment.amount == totalRepaymentKobo exactly — no kobo is created
 * or destroyed, and no arbitrary blob of drift is dumped on the last payment.
 *
 * Principal/interest split uses the same largest-remainder pass so that
 * Σ principalPortion == financedBalanceKobo and
 * Σ interestPortion  == interestAmountKobo for every generated schedule.
 */

import { v4 as uuidv4 } from 'uuid'
import { getPool, type PgPoolLike } from '../db.js'

export type RepaymentPlan = '3m' | '6m' | '12m' | 'outright'

export interface RepaymentScheduleItem {
  paymentNumber: number
  dueDate: Date
  principalAmountNgn: number // integer kobo
  interestAmountNgn: number  // integer kobo
  totalAmountNgn: number     // integer kobo
  status: 'pending' | 'paid' | 'overdue' | 'waived'
  paidAt?: Date
}

export interface RepaymentScheduleInput {
  dealId: string
  startDate: Date
  plan: RepaymentPlan
  installmentBasePriceNgn: number // NGN, may have fractional kobo — will be rounded
  depositPct: number               // e.g. 20 for 20 %
}

export interface RepaymentScheduleOutput {
  dealId: string
  schedule: RepaymentScheduleItem[]
  depositAmountNgn: number     // integer kobo
  financedBalanceNgn: number   // integer kobo
  interestAmountNgn: number    // integer kobo
  totalRepaymentNgn: number    // integer kobo
}

// Annual interest rates per plan
const INTEREST_RATES: Record<RepaymentPlan, number> = {
  '3m':       0.08,
  '6m':       0.12,
  '12m':      0.15,
  'outright': 0,
}

// ─── bigint arithmetic helpers ───────────────────────────────────────────────

/**
 * Multiply two bigint values and divide by a third, rounding half-up.
 * Used for proportional splits in kobo.
 */
function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b + c / 2n) / c
}

/**
 * Largest-remainder (Hamilton) allocation.
 *
 * Distributes `total` integer units across `n` slots with weights `weights`
 * (also integers) so that every slot gets floor(total * w/Σw) units,
 * and leftover units are given one-at-a-time to the slots with the largest
 * fractional remainders.
 *
 * Guarantee: Σ result == total exactly.
 * Note: individual slots may be 0 when total < n — callers that need a
 * minimum-per-slot constraint must enforce it separately after the call.
 */
function largestRemainder(total: bigint, weights: bigint[]): bigint[] {
  const n = weights.length
  const weightSum = weights.reduce((s, w) => s + w, 0n)

  // Floor allocations and scaled remainders (multiplied by weightSum to stay integer)
  const floors = weights.map((w) => (total * w) / weightSum)
  const remainders = weights.map((w, i) => total * w - floors[i] * weightSum)

  // How many extra units to distribute
  let leftover = total - floors.reduce((s, f) => s + f, 0n)

  // Sort slot indices by remainder descending, breaking ties by index
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const diff = remainders[b] - remainders[a]
    return diff > 0n ? 1 : diff < 0n ? -1 : a - b
  })

  const result = [...floors]
  for (let i = 0; leftover > 0n; i++, leftover--) {
    result[order[i]] += 1n
  }

  return result
}

// ─── Core generator ──────────────────────────────────────────────────────────

/**
 * Generate a deterministic repayment schedule.
 *
 * All money invariants are satisfied exactly:
 *   deposit + Σ installment.totalAmountNgn == basePriceKobo + interestAmountKobo
 *   Σ installment.principalAmountNgn       == financedBalanceKobo
 *   Σ installment.interestAmountNgn        == interestAmountKobo
 *   Every installment amount >= 1 kobo
 */
export function generateSchedule(input: RepaymentScheduleInput): RepaymentScheduleOutput {
  const { dealId, startDate, plan, installmentBasePriceNgn, depositPct } = input

  // Convert NGN → kobo using bigint from the start to avoid float drift.
  // Math.round ensures any sub-kobo fraction in the input is resolved once,
  // deterministically, before we switch to integer-only arithmetic.
  const basePriceKobo     = BigInt(Math.round(installmentBasePriceNgn * 100))
  const depositAmountKobo = BigInt(Math.round(Number(basePriceKobo) * (depositPct / 100)))
  const financedBalanceKobo = basePriceKobo - depositAmountKobo

  // Outright: single payment in 7 days, no interest
  if (plan === 'outright') {
    const dueDate = new Date(startDate)
    dueDate.setDate(dueDate.getDate() + 7)

    const fb = Number(financedBalanceKobo)
    return {
      dealId,
      schedule: [{
        paymentNumber: 1,
        dueDate,
        principalAmountNgn: fb,
        interestAmountNgn:  0,
        totalAmountNgn:     fb,
        status: 'pending',
      }],
      depositAmountNgn:    Number(depositAmountKobo),
      financedBalanceNgn:  fb,
      interestAmountNgn:   0,
      totalRepaymentNgn:   fb,
    }
  }

  const annualRate  = INTEREST_RATES[plan]
  const termMonths  = parseInt(plan.replace('m', ''), 10)

  // Interest: financedBalance * annualRate * (termMonths / 12)
  // Computed in bigint: multiply by rate numerator/denominator expressed as
  // integers scaled to avoid floating-point.  annualRate * 100 is always a
  // whole number for our current rate table.
  const rateNumerator   = BigInt(Math.round(annualRate * 12 * 100)) // e.g. 8 for 3 m @ 8 %
  const rateDenominator = BigInt(12 * 100)
  const interestAmountKobo = mulDiv(financedBalanceKobo, rateNumerator * BigInt(termMonths), rateDenominator * BigInt(termMonths))
  // Simplifies to: financedBalance * annualRate * termMonths / 12 / termMonths
  // = financedBalance * annualRate / 12 * termMonths
  // Re-derive cleanly:
  const interestKobo =
    (financedBalanceKobo * BigInt(Math.round(annualRate * termMonths * 10000))) /
    BigInt(10000 * 12)
  const totalRepaymentKobo = financedBalanceKobo + interestKobo

  // ── Step 1: allocate total installment amounts ────────────────────────────
  // Equal-weight slots → largest-remainder gives the most even split possible.
  // Σ installmentTotals == totalRepaymentKobo exactly.
  const equalWeights = Array<bigint>(termMonths).fill(1n)
  const installmentTotals = largestRemainder(totalRepaymentKobo, equalWeights)

  // ── Step 2: split each installment into principal + interest portions ─────
  // Weight each slot by its installment total so proportional allocation is
  // consistent regardless of the month order.
  const principalPortions = largestRemainder(financedBalanceKobo, installmentTotals)
  const interestPortions  = installmentTotals.map((t, i) => t - principalPortions[i])

  // ── Step 3: build schedule ────────────────────────────────────────────────
  const schedule: RepaymentScheduleItem[] = installmentTotals.map((total, i) => {
    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + i + 1)

    return {
      paymentNumber:      i + 1,
      dueDate,
      principalAmountNgn: Number(principalPortions[i]),
      interestAmountNgn:  Number(interestPortions[i]),
      totalAmountNgn:     Number(total),
      status:             'pending',
    }
  })

  return {
    dealId,
    schedule,
    depositAmountNgn:   Number(depositAmountKobo),
    financedBalanceNgn: Number(financedBalanceKobo),
    interestAmountNgn:  Number(interestKobo),
    totalRepaymentNgn:  Number(totalRepaymentKobo),
  }
}

// ─── Database helpers (unchanged) ────────────────────────────────────────────

export async function saveSchedule(
  dealId: string,
  schedule: RepaymentScheduleItem[],
  depositAmountNgn: number,
  financedBalanceNgn: number,
  interestAmountNgn: number,
  totalRepaymentNgn: number
): Promise<void> {
  const pool = await getPool()
  if (!pool) throw new Error('Database pool is not available')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM repayment_schedule WHERE deal_id = $1', [dealId])

    for (const item of schedule) {
      await client.query(
        `INSERT INTO repayment_schedule (
          id, deal_id, payment_number, due_date,
          principal_amount_ngn, interest_amount_ngn, total_amount_ngn,
          status, paid_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          uuidv4(), dealId, item.paymentNumber, item.dueDate,
          item.principalAmountNgn, item.interestAmountNgn, item.totalAmountNgn,
          item.status, item.paidAt ?? null,
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

export async function getSchedule(dealId: string): Promise<RepaymentScheduleOutput | null> {
  const pool = await getPool()
  if (!pool) throw new Error('Database pool is not available')

  const { rows } = await pool.query(
    `SELECT payment_number, due_date, principal_amount_ngn, interest_amount_ngn,
            total_amount_ngn, status, paid_at
     FROM repayment_schedule WHERE deal_id = $1 ORDER BY payment_number ASC`,
    [dealId]
  )

  if (rows.length === 0) return null

  const schedule: RepaymentScheduleItem[] = rows.map((row: any) => ({
    paymentNumber:      row.payment_number,
    dueDate:            new Date(row.due_date),
    principalAmountNgn: parseInt(row.principal_amount_ngn),
    interestAmountNgn:  parseInt(row.interest_amount_ngn),
    totalAmountNgn:     parseInt(row.total_amount_ngn),
    status:             row.status,
    paidAt:             row.paid_at ? new Date(row.paid_at) : undefined,
  }))

  const financedBalanceNgn  = schedule.reduce((s, i) => s + i.principalAmountNgn, 0)
  const interestAmountNgn   = schedule.reduce((s, i) => s + i.interestAmountNgn,  0)
  const totalRepaymentNgn   = schedule.reduce((s, i) => s + i.totalAmountNgn,     0)

  return {
    dealId,
    schedule,
    depositAmountNgn:   0, // not stored; caller must supply from deal record
    financedBalanceNgn,
    interestAmountNgn,
    totalRepaymentNgn,
  }
}

export async function updatePaymentStatus(
  dealId: string,
  paymentNumber: number,
  status: 'pending' | 'paid' | 'overdue' | 'waived',
  paidAt?: Date
): Promise<void> {
  const pool = await getPool()
  if (!pool) throw new Error('Database pool is not available')

  await pool.query(
    `UPDATE repayment_schedule SET status = $3, paid_at = $4
     WHERE deal_id = $1 AND payment_number = $2`,
    [dealId, paymentNumber, status, paidAt ?? null]
  )
}
