import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tenantOnboardingDataStore } from '../models/tenantOnboardingDataStore.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { underwritingDecisionTraceStore } from '../models/underwritingDecisionTraceStore.js'
import { UnderwritingService } from './underwritingService.js'
import { UnderwritingRuleEngine, DEFAULT_RULE_CONFIG } from './underwritingRuleEngine.js'
import {
  AiRiskScoringService,
  applyAiRiskOverride,
  shouldRequestAiScore,
} from './aiRiskScoringService.js'
import { StubAiRiskScoreProvider } from './stubAiRiskScoreProvider.js'
import type { AiRiskScoreProvider, AiRiskScoreResult, TenantRiskProfile } from './aiRiskScoreProvider.js'

const TENANT = 'ai-risk-tenant'

function seedStrongOnboarding(incomeToRent = 5) {
  const monthlyRent = 100_000
  tenantOnboardingDataStore.upsert(TENANT, {
    statedMonthlyIncome: monthlyRent * incomeToRent,
    monthlyRent,
    employmentStatus: 'employed',
    employerName: 'Acme Corp',
    employmentProofText: 'Employment letter from Acme Corp',
    bankStatementLines: [
      { date: '2026-01-01', description: 'Salary payroll credit', amount: monthlyRent * incomeToRent },
      { date: '2026-02-01', description: 'Salary payroll credit', amount: monthlyRent * incomeToRent },
      { date: '2026-03-01', description: 'Salary payroll credit', amount: monthlyRent * incomeToRent },
    ],
  })
}

class VeryHighRiskMockProvider implements AiRiskScoreProvider {
  async score(_profile: TenantRiskProfile): Promise<AiRiskScoreResult> {
    return {
      score: 92,
      confidence: 0.92,
      riskBand: 'very_high',
      contributingFactors: ['mock very high risk'],
      modelVersion: 'mock-v1',
    }
  }
}

describe('AI risk scoring integration', () => {
  beforeEach(async () => {
    tenantOnboardingDataStore.clear()
    await (tenantApplicationStore as { clear?: () => Promise<void> }).clear?.()
    await (underwritingDecisionTraceStore as { clear?: () => Promise<void> }).clear?.()
    vi.stubEnv('AI_SCORING_ENABLED', 'true')
    vi.stubEnv('AI_SCORING_PROVIDER', 'stub')
  })

  it('uses stub provider without external API', async () => {
    seedStrongOnboarding(5)
    const aiService = new AiRiskScoringService(new StubAiRiskScoreProvider(), {
      enabled: true,
      provider: 'stub',
      model: 'claude-sonnet-4-6',
      cacheTtlMs: 86_400_000,
    })
    const underwriting = new UnderwritingService(
      new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG),
      undefined,
      aiService,
    )

    const application = await tenantApplicationStore.create({
      userId: TENANT,
      propertyId: 1,
      annualRent: 1_200_000,
      deposit: 360_000,
      duration: 12,
      hasAgreedToTerms: true,
    })

    const result = await underwriting.evaluateApplication({
      applicationId: application.applicationId,
    })

    expect(result.aiRiskScore?.riskBand).toBe('low')
    const traces = await underwritingDecisionTraceStore.findByApplicationId(application.applicationId)
    expect(traces[0].aiRiskScore?.modelVersion).toContain('stub')
  })

  it('overrides APPROVE to REVIEW when AI is very_high with high confidence', async () => {
    seedStrongOnboarding(5)
    const aiService = new AiRiskScoringService(new VeryHighRiskMockProvider(), {
      enabled: true,
      provider: 'stub',
      model: 'claude-sonnet-4-6',
      cacheTtlMs: 86_400_000,
    })
    const underwriting = new UnderwritingService(
      new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG),
      undefined,
      aiService,
    )

    const application = await tenantApplicationStore.create({
      userId: TENANT,
      propertyId: 1,
      annualRent: 1_200_000,
      deposit: 360_000,
      duration: 12,
      hasAgreedToTerms: true,
    })

    const result = await underwriting.evaluateApplication({
      applicationId: application.applicationId,
      paymentHistory: {
        onTimePaymentRate: 0.98,
        missedPayments: 0,
        totalPayments: 24,
      },
      backgroundCheckData: {
        employmentVerified: true,
        incomeStability: 'stable',
        averageMonthlyIncome: 600_000,
        overdraftCount: 0,
      },
    })

    expect(result.decision).toBe('REVIEW')
    expect(result.result.decisionReason).toContain('escalated to manual review')
    const traces = await underwritingDecisionTraceStore.findByApplicationId(application.applicationId)
    expect(traces[0].decision).toBe('REVIEW')
    expect(traces[0].aiRiskScore?.riskBand).toBe('very_high')
  })

  it('does not request AI scoring when deterministic decision is REJECT', async () => {
    seedStrongOnboarding(1.2)
    const scoreSpy = vi.fn()
    const provider: AiRiskScoreProvider = {
      score: scoreSpy,
    }
    const aiService = new AiRiskScoringService(provider, {
      enabled: true,
      provider: 'stub',
      model: 'claude-sonnet-4-6',
      cacheTtlMs: 86_400_000,
    })
    const underwriting = new UnderwritingService(
      new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG),
      undefined,
      aiService,
    )

    const application = await tenantApplicationStore.create({
      userId: TENANT,
      propertyId: 1,
      annualRent: 1_200_000,
      deposit: 10_000,
      duration: 12,
      hasAgreedToTerms: true,
    })

    await underwriting.evaluateApplication({ applicationId: application.applicationId })
    expect(scoreSpy).not.toHaveBeenCalled()
  })

  it('returns cached score without second provider call within TTL', async () => {
    seedStrongOnboarding(2.5)
    const scoreSpy = vi.fn(async (profile: TenantRiskProfile) => {
      const stub = new StubAiRiskScoreProvider()
      return stub.score(profile)
    })
    const provider: AiRiskScoreProvider = { score: scoreSpy }
    const aiService = new AiRiskScoringService(provider, {
      enabled: true,
      provider: 'stub',
      model: 'claude-sonnet-4-6',
      cacheTtlMs: 86_400_000,
    })

    const profile = aiService.buildProfile(TENANT)!
    await aiService.scoreProfile(profile)
    await aiService.scoreProfile(profile)

    expect(scoreSpy).toHaveBeenCalledTimes(1)
  })

  it('applyAiRiskOverride escalates only for very_high + confidence > 0.85', () => {
    expect(shouldRequestAiScore('REJECT')).toBe(false)
    expect(shouldRequestAiScore('APPROVE')).toBe(true)

    const low = applyAiRiskOverride('APPROVE', {
      score: 20,
      confidence: 0.95,
      riskBand: 'low',
      contributingFactors: [],
      modelVersion: 'x',
    })
    expect(low.decision).toBe('APPROVE')
    expect(low.overridden).toBe(false)

    const escalated = applyAiRiskOverride('APPROVE', {
      score: 90,
      confidence: 0.9,
      riskBand: 'very_high',
      contributingFactors: [],
      modelVersion: 'x',
    })
    expect(escalated.decision).toBe('REVIEW')
    expect(escalated.overridden).toBe(true)
  })
})
