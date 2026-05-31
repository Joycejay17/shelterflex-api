/**
 * Pricing Service - Two-tier pricing engine for outright vs installment payments
 */

export const INTEREST_TIERS: Record<number, number> = {
  3: 0.08,  // 8% for 3-month term
  6: 0.12,  // 12% for 6-month term
  12: 0.15, // 15% for 12-month term
}

export const MIN_DEPOSIT_PERCENT = 0.2 // 20% minimum deposit
export const MIN_OUTRIGHT_MARGIN_PERCENT = 0.05 // 5% minimum margin

export interface InstallmentSchedule {
  depositAmount: number
  financedBalance: number
  interestAmount: number
  monthlyPayment: number
  totalRepayment: number
}

export interface OutrightBreakdown {
  depositAmount: number
  balanceDue: number
  totalPayable: number
}

/**
 * Compute installment schedule for a given base price, deposit, and term
 */
export function computeInstallmentSchedule(
  installmentBasePriceNgn: number,
  depositPercent: number,
  termMonths: number,
): InstallmentSchedule {
  const interestRate = INTEREST_TIERS[termMonths]
  if (interestRate === undefined) {
    throw new Error(`Invalid term months: ${termMonths}. Must be 3, 6, or 12.`)
  }

  if (depositPercent < MIN_DEPOSIT_PERCENT || depositPercent > 1) {
    throw new Error(`Deposit percent must be between ${MIN_DEPOSIT_PERCENT} and 1.`)
  }

  const depositAmount = Math.round(installmentBasePriceNgn * depositPercent)
  const financedBalance = installmentBasePriceNgn - depositAmount
  const interestAmount = Math.round(financedBalance * interestRate)
  const totalRepayment = financedBalance + interestAmount
  const monthlyPayment = Math.round((totalRepayment / termMonths) * 100) / 100

  return {
    depositAmount,
    financedBalance,
    interestAmount,
    monthlyPayment,
    totalRepayment,
  }
}

/**
 * Compute outright (cash) payment breakdown - no interest
 */
export function computeOutrightBreakdown(
  outrightPriceNgn: number,
  depositPercent: number,
): OutrightBreakdown {
  if (depositPercent < MIN_DEPOSIT_PERCENT || depositPercent > 1) {
    throw new Error(`Deposit percent must be between ${MIN_DEPOSIT_PERCENT} and 1.`)
  }

  const depositAmount = Math.round(outrightPriceNgn * depositPercent)
  const balanceDue = outrightPriceNgn - depositAmount

  return {
    depositAmount,
    balanceDue,
    totalPayable: outrightPriceNgn,
  }
}

/**
 * Validate pricing configuration invariants
 * enforced: negotiatedRate < outrightPrice <= installmentBase
 */
export function validatePricingConfig(
  negotiatedLandlordRateNgn: number,
  outrightPriceNgn: number,
  installmentBasePriceNgn: number,
): void {
  if (negotiatedLandlordRateNgn >= outrightPriceNgn) {
    throw new PricingValidationError(
      'PRICING_MARGIN_VIOLATION',
      'Negotiated landlord rate must be less than outright price',
    )
  }

  if (outrightPriceNgn > installmentBasePriceNgn) {
    throw new PricingValidationError(
      'PRICING_ORDER_VIOLATION',
      'Outright price must be less than or equal to installment base price',
    )
  }

  // Check minimum outright margin
  const outrightMargin = (outrightPriceNgn - negotiatedLandlordRateNgn) / negotiatedLandlordRateNgn
  if (outrightMargin < MIN_OUTRIGHT_MARGIN_PERCENT) {
    throw new PricingValidationError(
      'PRICING_MARGIN_TOO_LOW',
      `Outright margin must be at least ${MIN_OUTRIGHT_MARGIN_PERCENT * 100}%. Current: ${(outrightMargin * 100).toFixed(1)}%`,
    )
  }
}

export class PricingValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PricingValidationError'
  }
}
