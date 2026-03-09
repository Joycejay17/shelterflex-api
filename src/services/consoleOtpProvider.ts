import { OtpDeliveryProvider, generateOtpEmailTemplate } from './otpDeliveryProvider.js'
import { logger } from '../utils/logger.js'
import { env } from '../schemas/env.js'

/**
 * Console OTP Provider
 * 
 * For development only. Logs OTP to console.
 * Never use in production.
 */
export class ConsoleOtpProvider implements OtpDeliveryProvider {
  async sendOtp(email: string, otp: string, ttlMinutes: number): Promise<void> {
    const template = generateOtpEmailTemplate(otp, ttlMinutes)
    
    // Only log OTP in development/test environments
    // In production, this provider should not be used
    if (env.NODE_ENV === 'production') {
      logger.warn('[OTP Delivery] Console Provider used in production - this should not happen', {
        email,
        // OTP is intentionally NOT logged in production
      })
      throw new Error('ConsoleOtpProvider should not be used in production. Set OTP_DELIVERY_PROVIDER=email')
    }
    
    // Log to console for development
    logger.info('[OTP Delivery] Console Provider', {
      email,
      subject: template.subject,
      // Only log OTP in development - this is intentional for dev convenience
      otp,
      ttlMinutes,
    })
    
    // Also log formatted email for easy copy-paste in dev
    console.log('\n' + '='.repeat(60))
    console.log('📧 OTP Email (Dev Mode)')
    console.log('='.repeat(60))
    console.log(`To: ${email}`)
    console.log(`Subject: ${template.subject}`)
    console.log(`\n${template.body}`)
    console.log('='.repeat(60) + '\n')
  }
}
