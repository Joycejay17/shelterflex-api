import { env } from '../schemas/env.js'
import { OtpDeliveryProvider } from './otpDeliveryProvider.js'
import { ConsoleOtpProvider } from './consoleOtpProvider.js'
import { EmailOtpProvider } from './emailOtpProvider.js'

/**
 * Factory function to create the appropriate OTP delivery provider
 * based on environment configuration.
 */
export function createOtpDeliveryProvider(): OtpDeliveryProvider {
  const provider = env.OTP_DELIVERY_PROVIDER

  switch (provider) {
    case 'console':
      return new ConsoleOtpProvider()
    case 'email':
      return new EmailOtpProvider()
    default:
      // Fallback to console for safety in development
      return new ConsoleOtpProvider()
  }
}
