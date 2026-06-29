import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../schemas/env.js', () => ({
  env: {
    OTP_DELIVERY_PROVIDER: 'console',
    NODE_ENV: 'development',
    RESEND_API_KEY: 'test-key',
    RESEND_FROM_EMAIL: 'test@example.com'
  }
}))

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null })
      }
    }
  }
})

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { createOtpDeliveryProvider } from './otpDeliveryFactory.js'

describe('OtpDeliveryFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a provider instance', () => {
    const provider = createOtpDeliveryProvider()
    expect(provider).toBeDefined()
    expect(typeof provider.sendOtp).toBe('function')
  })

  it('returns provider with sendOtp method', () => {
    const provider = createOtpDeliveryProvider()
    expect(provider).toHaveProperty('sendOtp')
  })
})
