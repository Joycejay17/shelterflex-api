import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import {
  getCreditScoringConfig,
  effectiveWeights,
  configVersionHash,
  type CreditScoringConfig,
} from '../config/creditScoring.js'
import {
  bandFromCompositeScore,
  type TenantCreditScore,
  type CreditBand,
} from '../models/tenantCreditScore.js'
import { tenantCreditScoreStore, type CreditScoreRecord } from '../models/tenantCreditScoreStore.js'
import {
  tenantOnboardingDataStore,
  type TenantOnboardingData,
} from '../models/tenantOnboardingDataStore.js'
import { analyzeBankStatement, bankStatementSubScore } from './bankStatementAnalysis.js'
import type { RiskBand, FactorWeight } from '../schemas/creditScoring.js'

const NSF_PATTERN = /\b(NSF|non[- ]?sufficient|returned item|returned check|insufficient funds|bounced)\b/i

function clampSubScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function sumBankCredits(lines: TenantOnboardingData['bankStatementLines']): number {
  return lines.filter((l) => l.amount > 0).reduce((sum, l) => sum + l.amount, 0)
}

function monthlyIncomeFromBank(lines: TenantOnboardingData['bankStatementLines']): number {
  const credits = lines.filter((l) => l.amount > 0)
  if (credits.length === 0) return 0
  const byMonth = new Map<string, number>()
  for (const line of credits) {
    const d = new Date(line.date)
    const key = Number.isNaN(d.getTime())
      ? 'unknown'
      : `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + line.amount)
  }
  const totals = [...byMonth.values()]
  return totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 0
}

export class TenantCreditScoringService {
  private config: CreditScoringConfig

  constructor(config: CreditScoringConfig = getCreditScoringConfig()) {
    this.config = config
  }

  getOnboardingData(tenantId: string): TenantOnboardingData | undefined {
    return tenantOnboardingDataStore.findByTenantId(tenantId)
  }

  /**
   * Verify stated monthly income against bank credits; factor income-to-rent ratio.
   * Returns sub-score 0–100.
   */
  scoreIncome(tenantId: string): number {
    const data = tenantOnboardingDataStore.findByTenantId(tenantId)
    if (!data) return 0

    const verifiedMonthly = monthlyIncomeFromBank(data.bankStatementLines)
    const stated = data.statedMonthlyIncome
    let score = 40

    if (verifiedMonthly > 0 && stated > 0) {
      const ratio = verifiedMonthly / stated
      if (ratio >= 0.8 && ratio <= 1.2) score += 35
      else if (ratio >= 0.6 && ratio <= 1.4) score += 20
      else score += 5
    }

    const rent = data.monthlyRent
    if (rent > 0 && stated > 0) {
      const incomeToRent = stated / rent
      if (incomeToRent >= 3) score += 25
      else if (incomeToRent >= 2) score += 15
      else if (incomeToRent >= 1.5) score += 5
    }

    return clampSubScore(score)
  }

  /**
   * Validate employment status and employer name against uploaded proof text.
   */
  scoreEmployment(tenantId: string): number {
    const data = tenantOnboardingDataStore.findByTenantId(tenantId)
    if (!data) return 0

    const status = data.employmentStatus.toLowerCase()
    if (status === 'unemployed' || status === 'none') return 10

    let score = 50
    if (status === 'employed' || status === 'self_employed') score += 20

    const proof = (data.employmentProofText ?? '').toLowerCase()
    const employer = data.employerName.trim().toLowerCase()
    if (employer.length > 0 && proof.includes(employer)) score += 30
    else if (employer.length > 0) score += 10

    return clampSubScore(score)
  }

  /**
   * Analyse ~3-month statement: balance, income regularity, debt markers, NSF events.
   */
  scoreBankStatement(tenantId: string): number {
    const data = tenantOnboardingDataStore.findByTenantId(tenantId)
    if (!data || data.bankStatementLines.length === 0) return 0

    const analysis = analyzeBankStatement(data.bankStatementLines)
    return bankStatementSubScore(analysis)
  }

  /**
   * Optional mobile money signal; returns null when no data was provided.
   */
  scoreAlternativeData(tenantId: string): number | null {
    const data = tenantOnboardingDataStore.findByTenantId(tenantId)
    const txs = data?.mobileMoneyTransactions
    if (!txs || txs.length === 0) return null

    const credits = txs.filter((t) => t.type === 'credit')
    const volume = credits.reduce((s, t) => s + Math.abs(t.amount), 0)
    const frequency = credits.length

    let score = 40
    if (frequency >= 10) score += 30
    else if (frequency >= 5) score += 20
    else if (frequency >= 2) score += 10

    if (volume >= 500_000) score += 30
    else if (volume >= 100_000) score += 15

    return clampSubScore(score)
  }

  /**
   * Weighted composite (0–1000), persists to store. Idempotent for same data + config version.
   */
  computeCompositeScore(tenantId: string): TenantCreditScore {
    const data = tenantOnboardingDataStore.findByTenantId(tenantId)
    if (!data) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        404,
        'Onboarding verification data not found for tenant',
      )
    }

    const configHash = configVersionHash(this.config)
    const dataVersion = tenantOnboardingDataStore.dataVersionHash(tenantId, configHash)
    const existing = tenantCreditScoreStore.findPipelineByDataVersion(tenantId, dataVersion)
    if (existing) return existing

    const incomeScore = this.scoreIncome(tenantId)
    const employmentScore = this.scoreEmployment(tenantId)
    const bankStatementScore = this.scoreBankStatement(tenantId)
    const alternativeDataScore = this.scoreAlternativeData(tenantId)

    const hasAlt = alternativeDataScore !== null
    const weights = effectiveWeights(this.config.weights, hasAlt)

    const weighted =
      incomeScore * weights.income +
      employmentScore * weights.employment +
      bankStatementScore * weights.bankStatement +
      (hasAlt ? (alternativeDataScore ?? 0) * weights.alternativeData : 0)

    const score = Math.round(weighted * 10)
    const band = bandFromCompositeScore(score, this.config.bandThresholds)

    const record = tenantCreditScoreStore.savePipelineScore({
      tenantId,
      score,
      band,
      incomeScore,
      employmentScore,
      bankStatementScore,
      alternativeDataScore,
      computedAt: new Date(),
      version: this.config.version,
      dataVersion,
    })

    // Legacy factor record for RTI / admin list compatibility
    const verifiedIncome = monthlyIncomeFromBank(data.bankStatementLines) || data.statedMonthlyIncome
    tenantCreditScoreStore.create({
      tenantId,
      computedScore: score,
      riskBand: pipelineBandToLegacyRiskBand(band),
      factorInputs: {
        monthlyNetIncome: verifiedIncome,
        incomeScore,
        employmentScore,
        bankStatementScore,
        ...(alternativeDataScore !== null ? { alternativeDataScore } : {}),
      },
      factorWeights: {
        income: weights.income,
        employment: weights.employment,
        bankStatement: weights.bankStatement,
        alternativeData: weights.alternativeData,
      },
    })

    return record
  }

  getPipelineScore(tenantId: string): TenantCreditScore | undefined {
    return tenantCreditScoreStore.findPipelineByTenantId(tenantId)
  }

  // --- Legacy manual / factor API (unchanged behaviour) ---

  computeScore(factorInputs: Record<string, number>): {
    score: number
    riskBand: RiskBand
    factorWeights: Record<string, number>
    triggeredRules: string[]
  } {
    const config = tenantCreditScoreStore.getConfig()

    const totalWeight = config.factorWeights.reduce((sum, f) => sum + f.weight, 0)
    if (totalWeight !== 100) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `Factor weights must sum to 100, got ${totalWeight}`,
      )
    }

    let weightedScore = 0
    const appliedWeights: Record<string, number> = {}
    const triggeredRules: string[] = []

    for (const factor of config.factorWeights) {
      const inputValue = factorInputs[factor.factorName] ?? 0

      let normalizedValue = inputValue
      if (factor.normalization === 'logarithmic') {
        normalizedValue = Math.log1p(inputValue) * (100 / Math.log1p(100))
      } else if (factor.normalization === 'exponential') {
        normalizedValue = (Math.exp(inputValue / 100) - 1) * (100 / (Math.E - 1))
      }

      normalizedValue = Math.max(0, Math.min(100, normalizedValue))

      weightedScore += (normalizedValue * factor.weight) / 100
      appliedWeights[factor.factorName] = factor.weight

      if (factor.factorName === 'paymentHistory' && inputValue < 50) {
        triggeredRules.push('poor_payment_history')
      }
      if (factor.factorName === 'applicationData' && inputValue < 40) {
        triggeredRules.push('incomplete_application_data')
      }
      if (factor.factorName === 'behavioralSignals' && inputValue < 30) {
        triggeredRules.push('concerning_behavioral_signals')
      }
    }

    const score = Math.round(weightedScore)
    const thresholds = config.riskBandThresholds
    let riskBand: RiskBand = 'declined'
    if (score >= thresholds.low) {
      riskBand = 'low'
    } else if (score >= thresholds.medium) {
      riskBand = 'medium'
    } else if (score >= thresholds.high) {
      riskBand = 'high'
    }

    return { score, riskBand, factorWeights: appliedWeights, triggeredRules }
  }

  scoreTenant(
    tenantId: string,
    factorInputs: Record<string, number>,
    triggeredRules?: string[],
  ): CreditScoreRecord {
    const { score, riskBand, factorWeights, triggeredRules: rules } = this.computeScore(factorInputs)

    return tenantCreditScoreStore.create({
      tenantId,
      computedScore: score,
      riskBand,
      factorInputs,
      factorWeights,
      triggeredRules: triggeredRules || rules,
    })
  }

  overrideScore(
    tenantId: string,
    manualScore: number,
    reason: string,
    overriddenBy: string,
  ): CreditScoreRecord {
    const existingRecord = tenantCreditScoreStore.findByTenantId(tenantId)
    if (!existingRecord) {
      throw new AppError(ErrorCode.NOT_FOUND, 404, 'Credit score record not found for tenant')
    }

    const updated = tenantCreditScoreStore.updateOverride(existingRecord.id, {
      score: manualScore,
      reason,
      overriddenBy,
    })

    if (!updated) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 500, 'Failed to update override')
    }

    return updated
  }

  getTenantScore(tenantId: string): CreditScoreRecord | undefined {
    return tenantCreditScoreStore.findByTenantId(tenantId)
  }

  updateConfig(
    factorWeights: FactorWeight[],
    riskBandThresholds: {
      low: number
      medium: number
      high: number
      declined: number
    },
  ): void {
    const totalWeight = factorWeights.reduce((sum, f) => sum + f.weight, 0)
    if (totalWeight !== 100) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        `Factor weights must sum to 100, got ${totalWeight}`,
      )
    }

    if (riskBandThresholds.low <= riskBandThresholds.medium) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Low threshold must be greater than medium threshold',
      )
    }
    if (riskBandThresholds.medium <= riskBandThresholds.high) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'Medium threshold must be greater than high threshold',
      )
    }
    if (riskBandThresholds.high <= riskBandThresholds.declined) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        400,
        'High threshold must be greater than declined threshold',
      )
    }

    tenantCreditScoreStore.setConfig({
      factorWeights: factorWeights.map((f) => ({
        factorName: f.factorName,
        weight: f.weight,
        normalization: f.normalization || 'linear',
      })),
      riskBandThresholds,
    })
  }

  getConfig(): {
    factorWeights: Array<{ factorName: string; weight: number; normalization: string }>
    riskBandThresholds: { low: number; medium: number; high: number; declined: number }
  } {
    return tenantCreditScoreStore.getConfig()
  }
}

function pipelineBandToLegacyRiskBand(band: CreditBand): RiskBand {
  if (band === 'A' || band === 'B') return 'low'
  if (band === 'C') return 'medium'
  if (band === 'D') return 'high'
  return 'declined'
}

export const tenantCreditScoringService = new TenantCreditScoringService()

/** Detect NSF markers in raw statement text (exported for tests). */
export function hasNsfMarker(description: string): boolean {
  return NSF_PATTERN.test(description)
}
