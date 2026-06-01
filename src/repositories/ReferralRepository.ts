import { getPool } from '../db.js'
import type { ReferralCode, ReferralConversion } from '../schemas/referral.js'

export class ReferralRepository {
  async createReferralCode(tenantId: string, code: string): Promise<ReferralCode> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `INSERT INTO referral_codes (tenant_id, code)
       VALUES ($1, $2)
       RETURNING id, tenant_id, code, created_at`,
      [tenantId, code],
    )

    const row = rows[0]
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      createdAt: row.created_at,
    }
  }

  async getReferralCodeByTenantId(tenantId: string): Promise<ReferralCode | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `SELECT id, tenant_id, code, created_at FROM referral_codes WHERE tenant_id = $1`,
      [tenantId],
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      createdAt: row.created_at,
    }
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCode | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `SELECT id, tenant_id, code, created_at FROM referral_codes WHERE code = $1`,
      [code],
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      createdAt: row.created_at,
    }
  }

  async createConversion(
    referralCodeId: string,
    referrerTenantId: string,
    referredTenantId: string,
    rewardAmountNgn: number,
  ): Promise<ReferralConversion> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `INSERT INTO referral_conversions (referral_code_id, referrer_tenant_id, referred_tenant_id, reward_amount_ngn)
       VALUES ($1, $2, $3, $4)
       RETURNING id, referral_code_id, referrer_tenant_id, referred_tenant_id, deal_id, reward_amount_ngn, status, created_at, updated_at`,
      [referralCodeId, referrerTenantId, referredTenantId, rewardAmountNgn],
    )

    const row = rows[0]
    return {
      id: row.id,
      referralCodeId: row.referral_code_id,
      referrerTenantId: row.referrer_tenant_id,
      referredTenantId: row.referred_tenant_id,
      dealId: row.deal_id,
      rewardAmountNgn: row.reward_amount_ngn,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async getConversionsByReferrer(
    referrerTenantId: string,
  ): Promise<ReferralConversion[]> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `SELECT id, referral_code_id, referrer_tenant_id, referred_tenant_id, deal_id, reward_amount_ngn, status, created_at, updated_at
       FROM referral_conversions WHERE referrer_tenant_id = $1 ORDER BY created_at DESC`,
      [referrerTenantId],
    )

    return rows.map((row) => ({
      id: row.id,
      referralCodeId: row.referral_code_id,
      referrerTenantId: row.referrer_tenant_id,
      referredTenantId: row.referred_tenant_id,
      dealId: row.deal_id,
      rewardAmountNgn: row.reward_amount_ngn,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  async getConversionByReferredTenant(referredTenantId: string): Promise<ReferralConversion | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `SELECT id, referral_code_id, referrer_tenant_id, referred_tenant_id, deal_id, reward_amount_ngn, status, created_at, updated_at
       FROM referral_conversions WHERE referred_tenant_id = $1 LIMIT 1`,
      [referredTenantId],
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      referralCodeId: row.referral_code_id,
      referrerTenantId: row.referrer_tenant_id,
      referredTenantId: row.referred_tenant_id,
      dealId: row.deal_id,
      rewardAmountNgn: row.reward_amount_ngn,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async updateConversionStatus(
    conversionId: string,
    status: 'pending' | 'credited' | 'applied' | 'cancelled',
  ): Promise<ReferralConversion | null> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `UPDATE referral_conversions SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, referral_code_id, referrer_tenant_id, referred_tenant_id, deal_id, reward_amount_ngn, status, created_at, updated_at`,
      [status, conversionId],
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      referralCodeId: row.referral_code_id,
      referrerTenantId: row.referrer_tenant_id,
      referredTenantId: row.referred_tenant_id,
      dealId: row.deal_id,
      rewardAmountNgn: row.reward_amount_ngn,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async getAllConversions(): Promise<ReferralConversion[]> {
    const pool = await getPool()
    if (!pool) throw new Error('Database not configured')

    const { rows } = await pool.query(
      `SELECT id, referral_code_id, referrer_tenant_id, referred_tenant_id, deal_id, reward_amount_ngn, status, created_at, updated_at
       FROM referral_conversions ORDER BY created_at DESC`,
    )

    return rows.map((row) => ({
      id: row.id,
      referralCodeId: row.referral_code_id,
      referrerTenantId: row.referrer_tenant_id,
      referredTenantId: row.referred_tenant_id,
      dealId: row.deal_id,
      rewardAmountNgn: row.reward_amount_ngn,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }
}

export const referralRepository = new ReferralRepository()
