/**
 * Pure NGN ↔ USDC conversion utilities for display serialization.
 * Rates are NGN per 1 USDC (fxRateNgnPerUsdc).
 */

export class ConversionMathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionMathError'
  }
}

export function convertNgnToUsdc(amountNgn: number, rate: number): number {
  if (!Number.isFinite(amountNgn) || !Number.isFinite(rate)) {
    throw new ConversionMathError('amountNgn and rate must be finite numbers')
  }
  if (amountNgn < 0) {
    throw new ConversionMathError('amountNgn must be non-negative')
  }
  if (rate <= 0) {
    throw new ConversionMathError('rate must be positive')
  }
  if (amountNgn === 0) return 0
  return amountNgn / rate
}

export function convertUsdcToNgn(amountUsdc: number, rate: number): number {
  if (!Number.isFinite(amountUsdc) || !Number.isFinite(rate)) {
    throw new ConversionMathError('amountUsdc and rate must be finite numbers')
  }
  if (amountUsdc < 0) {
    throw new ConversionMathError('amountUsdc must be non-negative')
  }
  if (rate <= 0) {
    throw new ConversionMathError('rate must be positive')
  }
  if (amountUsdc === 0) return 0
  return amountUsdc * rate
}

export function formatNgnDecimal(amount: number): string {
  return amount.toFixed(2)
}

export function formatUsdcDecimal(amount: number): string {
  return amount.toFixed(2)
}

export interface DisplayAmounts {
  ngn: string
  usdc: string
  rateUsed: number
}

/**
 * Compute dual-currency display strings from NGN and/or USDC inputs.
 * When only one side is provided, the other is derived using `rate`.
 */
export function getDisplayAmounts(
  amountNgn: number,
  amountUsdc?: number,
  rate?: number,
): DisplayAmounts {
  const fxRate = rate ?? (() => {
    throw new ConversionMathError('rate is required when amountUsdc is omitted')
  })()

  let ngn = amountNgn
  let usdc: number

  if (amountUsdc !== undefined) {
    usdc = amountUsdc
    if (amountNgn === 0 && amountUsdc > 0) {
      ngn = convertUsdcToNgn(amountUsdc, fxRate)
    } else if (amountUsdc === 0 && amountNgn > 0) {
      usdc = convertNgnToUsdc(amountNgn, fxRate)
    } else if (amountNgn > 0 && amountUsdc > 0) {
      usdc = amountUsdc
    } else {
      usdc = convertNgnToUsdc(amountNgn, fxRate)
    }
  } else {
    usdc = convertNgnToUsdc(amountNgn, fxRate)
  }

  return {
    ngn: formatNgnDecimal(ngn),
    usdc: formatUsdcDecimal(usdc),
    rateUsed: fxRate,
  }
}
