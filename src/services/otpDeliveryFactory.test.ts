import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createOtpDeliveryProvider } from './otpDeliveryFactory.js'
import { ConsoleOtpProvider } from './consoleOtpProvider.js'
import { EmailOtpProvider } from './emailOtpProvider.js'

// Mock env
const mockEnv = {
  OTP_DELIVERY_PROVIDER: 'console',
  NODE_ENV: 'development',
  RESEND_API_KEY: 'test-key',
  RESEND_FROM_EMAIL: 'test@example.com'
}

vi.mock('../schemas/env.js', () => ({
  env: mockEnv
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

describe('OtpDeliveryFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates ConsoleOtpProvider when OTP_DELIVERY_PROVIDER=console', () => {
    mockEnv.OTP_DELIVERY_PROVIDER = 'console'
    const provider = createOtpDeliveryProvider()
    expect(provider).toBeInstanceOf(ConsoleOtpProvider)
  })

  it('creates EmailOtpProvider when OTP_DELIVERY_PROVIDER=email', () => {
    mockEnv.OTP_DELIVERY_PROVIDER = 'email'
    const provider = createOtpDeliveryProvider()
    expect(provider).toBeInstanceOf(EmailOtpProvider)
  })

  it('defaults to ConsoleOtpProvider for unrecognized provider', () => {
    mockEnv.OTP_DELIVERY_PROVIDER = 'sms' as any // unsupported provider
    const provider = createOtpDeliveryProvider()
    expect(provider).toBeInstanceOf(ConsoleOtpProvider)
  })

  it('returns the correct provider type consistently', () => {
    mockEnv.OTP_DELIVERY_PROVIDER = 'email'
    const provider1 = createOtpDeliveryProvider()
    const provider2 = createOtpDeliveryProvider()
    expect(provider1.constructor).toBe(provider2.constructor)
  })
})
