import { customAlphabet } from 'nanoid'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { referralRepository } from '../repositories/ReferralRepository.js'
import type { ReferralCode, ReferralConversion, ReferralStats } from '../schemas/referral.js'

// Custom alphabet excluding ambiguous characters: 0, O, I, l
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const generateCode = customAlphabet(alphabet, 8)

const REFERRAL_REWARD_NGN = parseInt(process.env.REFERRAL_REWARD_NGN ?? '5000', 10)

export class ReferralService {
  /**
   * Generate a unique referral code for a tenant
   */
  async generateReferralCode(tenantId: string): Promise<ReferralCode> {
    // Check if tenant already has a referral code
    const existing = await referralRepository.getReferralCodeByTenantId(tenantId)
    if (existing) {
      return existing
    }

    // Generate unique code
    let code: string
    let isUnique = false
    let attempts = 0
    const maxAttempts = 10

    while (!isUnique && attempts < maxAttempts) {
      code = generateCode()
      const existing = await referralRepository.getReferralCodeByCode(code)
      if (!existing) {
        isUnique = true
      }
      attempts++
    }

    if (!isUnique) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        500,
        'Failed to generate unique referral code after multiple attempts',
      )
    }

    return referralRepository.createReferralCode(tenantId, code!)
  }

  /**
   * Apply a referral code during registration
   */
  async applyReferralCode(
    referralCode: string,
    referredTenantId: string,
  ): Promise<ReferralConversion> {
    // Validate referral code exists
    const refCode = await referralRepository.getReferralCodeByCode(referralCode)
    if (!refCode) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Invalid referral code')
    }

    // Prevent self-referral
    if (refCode.tenantId === referredTenantId) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'You cannot use your own referral code',
      )
    }

    // Check if referred tenant already has a conversion (prevent duplicate referrals)
    const existingConversion = await referralRepository.getConversionByReferredTenant(
      referredTenantId,
    )
    if (existingConversion) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'This tenant has already been referred',
      )
    }

    // Create conversion record
    return referralRepository.createConversion(
      refCode.id,
      refCode.tenantId,
      referredTenantId,
      REFERRAL_REWARD_NGN,
    )
  }

  /**
   * Get referral stats for a tenant
   */
  async getReferralStats(tenantId: string): Promise<ReferralStats> {
    // Get referral code
    const refCode = await referralRepository.getReferralCodeByTenantId(tenantId)
    if (!refCode) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Referral code not found')
    }

    // Get conversions
    const conversions = await referralRepository.getConversionsByReferrer(tenantId)

    // Calculate stats
    const totalReferred = conversions.length
    const pendingRewards = conversions.filter((c) => c.status === 'pending').length
    const appliedRewards = conversions.filter((c) => c.status === 'applied').length
    const totalRewardAmountNgn = conversions.reduce((sum, c) => sum + c.rewardAmountNgn, 0)

    return {
      code: refCode.code,
      referralLink: `https://shelterflex.app/register?ref=${refCode.code}`,
      totalReferred,
      pendingRewards,
      appliedRewards,
      totalRewardAmountNgn,
    }
  }

  /**
   * Credit reward when referred tenant's first deal activates
   * This should be called from the deal activation flow
   */
  async creditRewardForDealActivation(
    referredTenantId: string,
    dealId: string,
  ): Promise<void> {
    // Get the conversion for this referred tenant
    const conversion = await referralRepository.getConversionByReferredTenant(referredTenantId)
    if (!conversion) {
      // No referral conversion for this tenant, nothing to do
      return
    }

    // Update conversion status to credited and set deal ID
    const pool = await (await import('../db.js')).getPool()
    if (!pool) throw new Error('Database not configured')

    await pool.query(
      `UPDATE referral_conversions SET status = 'credited', deal_id = $1, updated_at = NOW() WHERE id = $2`,
      [dealId, conversion.id],
    )
  }

  /**
   * Apply credit to referrer's account
   * This should be called when the referrer is next billed
   */
  async applyRewardCredit(conversionId: string): Promise<void> {
    // This method will be called from the payment flow to apply the credit
    // For now, just update the status
    await referralRepository.updateConversionStatus(conversionId, 'applied')
  }
}

export const referralService = new ReferralService()
