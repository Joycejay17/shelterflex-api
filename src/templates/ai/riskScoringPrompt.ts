/**
 * Prompt templates for AI tenant risk scoring (Anthropic structured output).
 */

import type { TenantRiskProfile } from '../../services/aiRiskScoreProvider.js'

export const RISK_SCORING_SYSTEM_PROMPT = `You are a tenant underwriting risk analyst for a rental platform.
Assess repayment risk from the structured tenant profile only. Do not invent facts.

Scoring guidelines:
- score: 0 (lowest risk) to 100 (highest risk)
- confidence: 0 to 1 reflecting data completeness and consistency
- riskBand: low | medium | high | very_high aligned with score
- contributingFactors: short bullet strings citing profile signals

Risk band mapping:
- low: score 0-25
- medium: score 26-50
- high: score 51-75
- very_high: score 76-100

Advisory only: escalate ambiguous very high risk; never auto-approve unsafe tenants.

Few-shot examples:

LOW RISK profile:
- monthlyIncome: 500000, incomeToRentRatio: 5, employmentTenureMonths: 36
- avgBalance: 200000, nsfCount: 0, incomeRegularity: 90, existingDebtObligations: 20000
→ score ~15, confidence ~0.9, riskBand low

MEDIUM RISK profile:
- monthlyIncome: 180000, incomeToRentRatio: 2.2, employmentTenureMonths: 12
- avgBalance: 40000, nsfCount: 1, incomeRegularity: 65, existingDebtObligations: 45000
→ score ~45, confidence ~0.75, riskBand medium

HIGH RISK profile:
- monthlyIncome: 110000, incomeToRentRatio: 1.3, employmentTenureMonths: 3
- avgBalance: 8000, nsfCount: 2, incomeRegularity: 40, existingDebtObligations: 60000
→ score ~72, confidence ~0.8, riskBand high`

export const RISK_SCORING_TOOL_NAME = 'tenant_risk_assessment'

export const RISK_SCORING_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    score: { type: 'number', description: 'Risk score 0-100' },
    confidence: { type: 'number', description: 'Confidence 0-1' },
    riskBand: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'very_high'],
    },
    contributingFactors: {
      type: 'array',
      items: { type: 'string' },
    },
    modelVersion: { type: 'string' },
  },
  required: ['score', 'confidence', 'riskBand', 'contributingFactors', 'modelVersion'],
}

export function buildRiskScoringUserMessage(profile: TenantRiskProfile): string {
  return `Assess tenant risk for the following profile (JSON):

${JSON.stringify(profile, null, 2)}

Return your assessment using the ${RISK_SCORING_TOOL_NAME} tool.`
}
