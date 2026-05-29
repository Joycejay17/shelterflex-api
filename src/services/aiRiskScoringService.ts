/**
 * Orchestrates AI risk scoring: provider selection, 24h cache, override rules.
 */

import { LRUCache } from 'lru-cache'
import type { UnderwritingDecision } from './underwritingRuleEngine.js'
import { getAiScoringConfig, type AiScoringConfig } from '../config/aiScoring.js'
import {
  type AiRiskScoreProvider,
  type AiRiskScoreResult,
  type TenantRiskProfile,
  cacheKeyForProfile,
} from './aiRiskScoreProvider.js'
import { StubAiRiskScoreProvider } from './stubAiRiskScoreProvider.js'
import { OpenAiRiskScoreProvider } from './openAiRiskScoreProvider.js'
import { buildTenantRiskProfile } from './tenantRiskProfileBuilder.js'

export interface AiRiskOverrideResult {
  decision: UnderwritingDecision
  overridden: boolean
  aiRiskScore?: AiRiskScoreResult
}

export function shouldRequestAiScore(decision: UnderwritingDecision): boolean {
  return decision !== 'REJECT'
}

export function applyAiRiskOverride(
  decision: UnderwritingDecision,
  aiResult?: AiRiskScoreResult,
): AiRiskOverrideResult {
  if (
    decision === 'APPROVE' &&
    aiResult?.riskBand === 'very_high' &&
    aiResult.confidence > 0.85
  ) {
    return { decision: 'REVIEW', overridden: true, aiRiskScore: aiResult }
  }
  return { decision, overridden: false, aiRiskScore: aiResult }
}

export function createAiRiskScoreProvider(config: AiScoringConfig = getAiScoringConfig()): AiRiskScoreProvider {
  if (config.provider === 'claude') {
    return new OpenAiRiskScoreProvider(config)
  }
  return new StubAiRiskScoreProvider()
}

export class AiRiskScoringService {
  private config: AiScoringConfig
  private provider: AiRiskScoreProvider
  private cache: LRUCache<string, AiRiskScoreResult>

  constructor(
    provider?: AiRiskScoreProvider,
    config: AiScoringConfig = getAiScoringConfig(),
  ) {
    this.config = config
    this.provider = provider ?? createAiRiskScoreProvider(config)
    this.cache = new LRUCache<string, AiRiskScoreResult>({
      max: 10_000,
      ttl: config.cacheTtlMs,
    })
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  buildProfile(tenantId: string): TenantRiskProfile | undefined {
    return buildTenantRiskProfile(tenantId)
  }

  async scoreProfile(profile: TenantRiskProfile): Promise<AiRiskScoreResult> {
    const key = cacheKeyForProfile(profile)
    const cached = this.cache.get(key)
    if (cached) return cached

    const result = await this.provider.score(profile)
    this.cache.set(key, result)
    return result
  }

  /** @internal test helper */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Score tenant when enabled and deterministic decision is not REJECT.
   */
  async evaluateForUnderwriting(
    tenantId: string,
    deterministicDecision: UnderwritingDecision,
  ): Promise<AiRiskOverrideResult> {
    if (!this.config.enabled || !shouldRequestAiScore(deterministicDecision)) {
      return { decision: deterministicDecision, overridden: false }
    }

    const profile = this.buildProfile(tenantId)
    if (!profile) {
      return { decision: deterministicDecision, overridden: false }
    }

    const aiResult = await this.scoreProfile(profile)
    const override = applyAiRiskOverride(deterministicDecision, aiResult)

    if (override.overridden) {
      console.info(
        JSON.stringify({
          event: 'ai_risk_override',
          tenantId,
          aiScore: aiResult.score,
          aiRiskBand: aiResult.riskBand,
          aiConfidence: aiResult.confidence,
          fromDecision: deterministicDecision,
          toDecision: override.decision,
        }),
      )
    } else if (aiResult) {
      console.info(
        JSON.stringify({
          event: 'ai_risk_scored',
          tenantId,
          aiScore: aiResult.score,
          aiRiskBand: aiResult.riskBand,
          aiConfidence: aiResult.confidence,
          deterministicDecision,
        }),
      )
    }

    return override
  }
}

export const aiRiskScoringService = new AiRiskScoringService()
