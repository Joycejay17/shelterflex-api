import { OtpDeliveryProvider, generateOtpEmailTemplate } from './otpDeliveryProvider.js'
import { logger } from '../utils/logger.js'

/**
 * Email OTP Provider
 * 
 * Production-ready email provider for sending OTP codes.
 * Currently a stub implementation that can be extended with actual email service integration
 * (e.g., SendGrid, AWS SES, Resend, etc.)
 * 
 * IMPORTANT: Never log the plaintext OTP in production.
 */
export class EmailOtpProvider implements OtpDeliveryProvider {
  constructor(
    private config?: {
      // Future: Add email service configuration here
      // apiKey?: string
      // fromEmail?: string
      // service?: 'sendgrid' | 'ses' | 'resend'
    }
  ) {}

  async sendOtp(email: string, otp: string, ttlMinutes: number): Promise<void> {
    const template = generateOtpEmailTemplate(otp, ttlMinutes)
    
    // TODO: Integrate with actual email service
    // For now, this is a stub that logs (without OTP) for visibility
    logger.info('[OTP Delivery] Email Provider', {
      email,
      subject: template.subject,
      ttlMinutes,
      // NOTE: OTP is intentionally NOT logged here for security
    })
    
    // Stub implementation - replace with actual email service call
    // Example integration points:
    // - SendGrid: https://github.com/sendgrid/sendgrid-nodejs
    // - AWS SES: https://github.com/aws/aws-sdk-js-v3
    // - Resend: https://github.com/resendlabs/resend-node
    // - Nodemailer: https://github.com/nodemailer/nodemailer
    
    throw new Error(
      'EmailOtpProvider is not yet implemented. ' +
      'Please integrate with an email service (SendGrid, AWS SES, Resend, etc.) ' +
      'or use ConsoleOtpProvider for development.'
    )
  }
}
