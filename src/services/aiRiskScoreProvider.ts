/**
 * AI tenant risk scoring provider interface and shared types.
 */

export type AiRiskBand = 'low' | 'medium' | 'high' | 'very_high'

export interface TenantRiskProfile {
  tenantId: string
  dataVersion: number
  monthlyIncome: number
  incomeToRentRatio: number
  employmentTenureMonths: number
  bankMetrics: {
    averageBalance: number
    nsfCount: number
    incomeRegularity: number
  }
  existingDebtObligations: number
}

export interface AiRiskScoreResult {
  score: number
  confidence: number
  riskBand: AiRiskBand
  contributingFactors: string[]
  modelVersion: string
}

export interface AiRiskScoreProvider {
  score(profile: TenantRiskProfile): Promise<AiRiskScoreResult>
}

export function cacheKeyForProfile(profile: TenantRiskProfile): string {
  return `${profile.tenantId}:${profile.dataVersion}`
}

export function normalizeAiRiskScoreResult(raw: {
  score: number
  confidence: number
  riskBand: string
  contributingFactors: string[]
  modelVersion: string
}): AiRiskScoreResult {
  const score = Math.max(0, Math.min(100, Number(raw.score)))
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence)))
  const riskBand = raw.riskBand as AiRiskBand
  if (!['low', 'medium', 'high', 'very_high'].includes(riskBand)) {
    throw new Error(`Invalid AI risk band: ${raw.riskBand}`)
  }
  return {
    score,
    confidence,
    riskBand,
    contributingFactors: raw.contributingFactors,
    modelVersion: raw.modelVersion,
  }
}
