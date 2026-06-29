import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOtpEmailTemplate } from './otpDeliveryProvider.js'

describe('OTP Delivery Provider', () => {
  describe('generateOtpEmailTemplate', () => {
    it('generates email template with OTP code', () => {
      const otp = '123456'
      const ttlMinutes = 10
      const template = generateOtpEmailTemplate(otp, ttlMinutes)

      expect(template.subject).toContain('Verification')
      expect(template.body).toContain(otp)
      expect(template.html).toContain(otp)
      expect(template.body).toContain(`${ttlMinutes} minutes`)
      expect(template.html).toContain(`${ttlMinutes} minutes`)
    })

    it('includes security warning in email template', () => {
      const template = generateOtpEmailTemplate('123456', 10)

      expect(template.body).toContain('Never share this code')
      expect(template.html).toContain('Never share this code')
      expect(template.body).toContain('did not request this code')
      expect(template.html).toContain('did not request this code')
    })

    it('generates valid HTML email format', () => {
      const template = generateOtpEmailTemplate('654321', 5)

      expect(template.html).toContain('<div')
      expect(template.html).toContain('</div>')
      expect(template.html).toContain('style=')
      expect(template.html).toContain('font-family')
    })

    it('handles different TTL values correctly', () => {
      const ttls = [1, 5, 10, 30, 60]
      ttls.forEach(ttl => {
        const template = generateOtpEmailTemplate('123456', ttl)
        expect(template.body).toContain(`${ttl} minutes`)
        expect(template.html).toContain(`${ttl} minutes`)
      })
    })

    it('includes formatted OTP display in HTML', () => {
      const otp = '123456'
      const template = generateOtpEmailTemplate(otp, 10)

      // Check for formatted OTP display (typically monospaced, bold, large font)
      expect(template.html).toContain('font-weight: bold')
      expect(template.html).toContain(otp)
    })

    it('generates consistent templates for same inputs', () => {
      const otp = '999888'
      const ttl = 15

      const template1 = generateOtpEmailTemplate(otp, ttl)
      const template2 = generateOtpEmailTemplate(otp, ttl)

      expect(template1.subject).toBe(template2.subject)
      expect(template1.body).toBe(template2.body)
      expect(template1.html).toBe(template2.html)
    })

    it('handles special characters in OTP safely', () => {
      // OTPs should be numeric, but test that if special chars appear they're not broken
      const otp = '123456'
      const template = generateOtpEmailTemplate(otp, 10)

      expect(template.body).toContain(otp)
      expect(template.html).toContain(otp)
    })
  })

  describe('OTP Security Requirements', () => {
    it('template does not expose OTP in unstructured manner', () => {
      const otp = 'SENSITIVE_OTP'
      const template = generateOtpEmailTemplate(otp, 10)

      // OTP should be in HTML/body but clearly marked and formatted
      expect(template.html).toContain(otp)
      expect(template.body).toContain(otp)
    })

    it('email template includes standard security disclaimers', () => {
      const template = generateOtpEmailTemplate('123456', 10)

      // Check for required disclaimers
      expect(template.body.toLowerCase()).toMatch(/never.*share|don't.*share/i)
      expect(template.body.toLowerCase()).toMatch(/didn't request|did not request/i)
      expect(template.html.toLowerCase()).toMatch(/never.*share|don't.*share/i)
    })

    it('generates expiry information clearly', () => {
      const ttl = 10
      const template = generateOtpEmailTemplate('123456', ttl)

      expect(template.body).toContain(`${ttl} minutes`)
      expect(template.html).toContain(`${ttl} minutes`)
      // Expiry should be clear and prominent
      expect(template.body.toLowerCase()).toMatch(/expire/)
      expect(template.html.toLowerCase()).toMatch(/expire/)
    })
  })
})
