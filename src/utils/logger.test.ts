import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger } from './logger.js'

describe('logger PII masking', () => {
  let output: string[]

  beforeEach(() => {
    output = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args) => {
      output.push(String(chunk))
      return originalWrite(chunk, ...args)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redacts NIN, BVN, and bank account numbers from log fields', () => {
    logger.info('user onboarding', {
      nin: '12345678901',
      bvn: '22222222222',
      bankAccountNumber: '0123456789',
      userId: 'user-1',
    })

    const line = output.find((l) => l.includes('user onboarding'))
    expect(line).toBeDefined()
    const parsed = JSON.parse(line!)
    expect(parsed.nin).toBe('[REDACTED]')
    expect(parsed.bvn).toBe('[REDACTED]')
    expect(parsed.bankAccountNumber).toBe('[REDACTED]')
    expect(parsed.userId).toBe('user-1')
    expect(JSON.stringify(parsed)).not.toContain('12345678901')
    expect(JSON.stringify(parsed)).not.toContain('22222222222')
    expect(JSON.stringify(parsed)).not.toContain('0123456789')
  })

  it('redacts nested PII in request body logging', () => {
    logger.info('request body', {
      body: {
        personalInfo: {
          nin: '98765432109',
          bvn: '11111111111',
          fullName: 'Jane Doe',
        },
      },
    })

    const line = output.find((l) => l.includes('request body'))
    const parsed = JSON.parse(line!)
    expect(parsed.body.personalInfo.nin).toBe('[REDACTED]')
    expect(parsed.body.personalInfo.bvn).toBe('[REDACTED]')
    expect(parsed.body.personalInfo.fullName).toBe('[REDACTED]')
  })
})
