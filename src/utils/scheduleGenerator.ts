/**
 * Deterministic repayment schedule generator for ShelterFlex deals
 */

import { ScheduleItem, ScheduleItemStatus } from '../models/deal.js'

export interface ScheduleGeneratorInput {
  annualRentNgn: number
  depositNgn: number
  termMonths: number
  startDate: Date
}

/**
 * Generates a deterministic repayment schedule
 * 
 * Rounding strategy:
 * - Monthly payment is calculated as (annualRentNgn - depositNgn) / termMonths
 * - Each payment is rounded to 2 decimal places using standard rounding
 * - The final payment is adjusted to account for any rounding discrepancy
 * 
 * Status determination:
 * - All items start as 'upcoming'
 * - Status updates are handled elsewhere based on current date and payment state
 */
export function generateRepaymentSchedule(input: ScheduleGeneratorInput): ScheduleItem[] {
  const { annualRentNgn, depositNgn, termMonths, startDate } = input
  
  const financedAmount = annualRentNgn - depositNgn
  const baseMonthlyPayment = financedAmount / termMonths
  
  const schedule: ScheduleItem[] = []
  
  // Generate all but the last payment with standard rounding
  for (let period = 1; period < termMonths; period++) {
    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + period)
    
    const amountNgn = Math.round(baseMonthlyPayment * 100) / 100
    
    schedule.push({
      period,
      dueDate: dueDate.toISOString(),
      amountNgn,
      status: ScheduleItemStatus.UPCOMING
    })
  }
  
  // Calculate final payment to account for rounding discrepancy
  const sumOfPreviousPayments = schedule.reduce((sum, item) => sum + item.amountNgn, 0)
  const finalPaymentAmount = financedAmount - sumOfPreviousPayments
  const finalPaymentRounded = Math.round(finalPaymentAmount * 100) / 100
  
  const finalDueDate = new Date(startDate)
  finalDueDate.setMonth(finalDueDate.getMonth() + termMonths)
  
  schedule.push({
    period: termMonths,
    dueDate: finalDueDate.toISOString(),
    amountNgn: finalPaymentRounded,
    status: ScheduleItemStatus.UPCOMING
  })
  
  return schedule
}

/**
 * Updates schedule item statuses based on current date and payment state
 */
export function updateScheduleStatuses(
  schedule: ScheduleItem[],
  currentDate: Date = new Date(),
  paidPeriods: number[] = []
): ScheduleItem[] {
  return schedule.map(item => {
    const dueDate = new Date(item.dueDate)
    const isPaid = paidPeriods.includes(item.period)
    
    if (isPaid) {
      return { ...item, status: ScheduleItemStatus.PAID }
    }
    
    if (currentDate < dueDate) {
      return { ...item, status: ScheduleItemStatus.UPCOMING }
    }
    
    // Check if it's within grace period (e.g., 5 days after due date)
    const gracePeriodDays = 5
    const gracePeriodEnd = new Date(dueDate)
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays)
    
    if (currentDate <= gracePeriodEnd) {
      return { ...item, status: ScheduleItemStatus.DUE }
    }
    
    return { ...item, status: ScheduleItemStatus.LATE }
  })
}

/**
 * Calculates total amount paid for given periods
 */
export function calculateTotalPaid(schedule: ScheduleItem[], paidPeriods: number[]): number {
  return paidPeriods.reduce((total, period) => {
    const item = schedule.find(s => s.period === period)
    return total + (item?.amountNgn || 0)
  }, 0)
}

/**
 * Calculates remaining balance
 */
export function calculateRemainingBalance(schedule: ScheduleItem[], paidPeriods: number[]): number {
  const paidPeriodsSet = new Set(paidPeriods)
  return schedule
    .filter(item => !paidPeriodsSet.has(item.period))
    .reduce((total, item) => total + item.amountNgn, 0)
}
