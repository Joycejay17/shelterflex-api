import { describe, it, expect } from 'vitest'
import {
  ConversionMathError,
  convertNgnToUsdc,
  convertUsdcToNgn,
  getDisplayAmounts,
} from './conversionUtils.js'

describe('convertNgnToUsdc', () => {
  it('converts using rate', () => {
    expect(convertNgnToUsdc(1600, 1600)).toBe(1)
  })

  it('returns 0 for zero NGN', () => {
    expect(convertNgnToUsdc(0, 1600)).toBe(0)
  })

  it('rejects negative NGN', () => {
    expect(() => convertNgnToUsdc(-1, 1600)).toThrow(ConversionMathError)
  })

  it('rejects zero or negative rate', () => {
    expect(() => convertNgnToUsdc(100, 0)).toThrow(ConversionMathError)
    expect(() => convertNgnToUsdc(100, -1)).toThrow(ConversionMathError)
  })
})

describe('convertUsdcToNgn', () => {
  it('converts using rate', () => {
    expect(convertUsdcToNgn(1, 1600)).toBe(1600)
  })

  it('returns 0 for zero USDC', () => {
    expect(convertUsdcToNgn(0, 1600)).toBe(0)
  })

  it('rejects negative USDC', () => {
    expect(() => convertUsdcToNgn(-0.01, 1600)).toThrow(ConversionMathError)
  })

  it('rejects zero or negative rate', () => {
    expect(() => convertUsdcToNgn(1, 0)).toThrow(ConversionMathError)
  })
})

describe('getDisplayAmounts', () => {
  it('derives USDC from NGN when only NGN provided', () => {
    const d = getDisplayAmounts(1600, undefined, 1600)
    expect(d.ngn).toBe('1600.00')
    expect(d.usdc).toBe('1.00')
    expect(d.rateUsed).toBe(1600)
  })

  it('uses both amounts when provided', () => {
    const d = getDisplayAmounts(3200, 2, 1600)
    expect(d.ngn).toBe('3200.00')
    expect(d.usdc).toBe('2.00')
  })
})
