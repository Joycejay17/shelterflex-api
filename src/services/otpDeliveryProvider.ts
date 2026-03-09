/**
 * OTP Delivery Provider Interface
 * 
 * Abstraction for delivering OTP codes to users via different channels.
 * Ensures plaintext OTP is never stored or logged in production.
 */
export interface OtpDeliveryProvider {
  /**
   * Send an OTP code to the user
   * @param email - User's email address
   * @param otp - The OTP code (plaintext, must not be stored or logged in production)
   * @param ttlMinutes - Time to live in minutes
   * @returns Promise that resolves when OTP is sent
   */
  sendOtp(email: string, otp: string, ttlMinutes: number): Promise<void>
}

/**
 * OTP email template data
 */
export interface OtpEmailTemplate {
  subject: string
  body: string
}

/**
 * Generate OTP email template with security hints
 */
export function generateOtpEmailTemplate(
  otp: string,
  ttlMinutes: number,
): OtpEmailTemplate {
  const subject = 'Your Verification Code'
  
  const body = `
Your verification code is: ${otp}

This code will expire in ${ttlMinutes} minutes.

Security tip: Never share this code with anyone. We will never ask for it via phone or email.

If you didn't request this code, please ignore this message.
`.trim()

  return { subject, body }
}
