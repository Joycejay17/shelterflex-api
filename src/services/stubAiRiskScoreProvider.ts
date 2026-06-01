/**
 * Deterministic AI risk scorer for tests and local dev (no external API).
 */

import type {
  AiRiskScoreProvider,
  AiRiskScoreResult,
  TenantRiskProfile,
} from './aiRiskScoreProvider.js'
import { normalizeAiRiskScoreResult } from './aiRiskScoreProvider.js'

const STUB_MODEL_VERSION = 'stub-income-ratio-v1'

export class StubAiRiskScoreProvider implements AiRiskScoreProvider {
  async score(profile: TenantRiskProfile): Promise<AiRiskScoreResult> {
    const ratio = profile.incomeToRentRatio
    let score: number
    let riskBand: 'low' | 'medium' | 'high' | 'very_high'
    const factors: string[] = [`income-to-rent ratio ${ratio.toFixed(2)}`]

    if (ratio >= 3) {
      score = 18
      riskBand = 'low'
      factors.push('strong income cushion vs rent')
    } else if (ratio >= 2) {
      score = 42
      riskBand = 'medium'
    } else if (ratio >= 1.5) {
      score = 68
      riskBand = 'high'
      factors.push('thin income buffer')
    } else {
      score = 88
      riskBand = 'very_high'
      factors.push('income below safe rent multiple')
    }

    return normalizeAiRiskScoreResult({
      score,
      confidence: 0.9,
      riskBand,
      contributingFactors: factors,
      modelVersion: STUB_MODEL_VERSION,
    })
  }
}
