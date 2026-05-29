import { describe, it, expect, beforeEach } from 'vitest'
import { tenantOnboardingDataStore } from '../models/tenantOnboardingDataStore.js'
import { tenantCreditScoreStore } from '../models/tenantCreditScoreStore.js'
import { tenantApplicationStore } from '../models/tenantApplicationStore.js'
import { underwritingDecisionTraceStore } from '../models/underwritingDecisionTraceStore.js'
import { tenantCreditScoringService } from './tenantCreditScoringService.js'
import { UnderwritingService } from './underwritingService.js'
import { UnderwritingRuleEngine, DEFAULT_RULE_CONFIG } from './underwritingRuleEngine.js'
import { decisionFromCreditBand } from '../models/tenantCreditScore.js'

const TENANT = 'pipeline-tenant'

function strongOnboarding() {
  tenantOnboardingDataStore.upsert(TENANT, {
    statedMonthlyIncome: 500_000,
    monthlyRent: 100_000,
    employmentStatus: 'employed',
    employerName: 'Shelterflex Ltd',
    employmentProofText: 'Employment letter from Shelterflex Ltd',
    bankStatementLines: [
      { date: '2026-01-01', description: 'Salary payroll credit', amount: 480_000 },
      { date: '2026-02-01', description: 'Salary payroll credit', amount: 490_000 },
      { date: '2026-03-01', description: 'Salary payroll credit', amount: 500_000 },
    ],
    mobileMoneyTransactions: Array.from({ length: 12 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      amount: 15_000,
      type: 'credit' as const,
    })),
  })
}

function weakOnboarding() {
  tenantOnboardingDataStore.upsert(TENANT, {
    statedMonthlyIncome: 120_000,
    monthlyRent: 100_000,
    employmentStatus: 'unemployed',
    employerName: '',
    bankStatementLines: [
      { date: '2026-01-05', description: 'NSF insufficient funds', amount: -2000 },
      { date: '2026-02-05', description: 'returned item', amount: -1500 },
    ],
  })
}

describe('credit scoring pipeline integration', () => {
  let underwriting: UnderwritingService

  beforeEach(async () => {
    tenantOnboardingDataStore.clear()
    tenantCreditScoreStore.clear()
    await (tenantApplicationStore as { clear?: () => Promise<void> }).clear?.()
    await (underwritingDecisionTraceStore as { clear?: () => Promise<void> }).clear?.()
    underwriting = new UnderwritingService(new UnderwritingRuleEngine(DEFAULT_RULE_CONFIG))
  })

  it('maps band A/B to approve, C to manual review, D/F to reject', () => {
    expect(decisionFromCreditBand('A')).toBe('approve')
    expect(decisionFromCreditBand('B')).toBe('approve')
    expect(decisionFromCreditBand('C')).toBe('manual_review')
    expect(decisionFromCreditBand('D')).toBe('reject')
    expect(decisionFromCreditBand('F')).toBe('reject')
  })

  it('runs full pipeline on onboarding submit path', async () => {
    strongOnboarding()
    const application = await tenantApplicationStore.create({
      userId: TENANT,
      propertyId: 1,
      annualRent: 1_200_000,
      deposit: 360_000,
      duration: 12,
      hasAgreedToTerms: true,
    })

    const credit = tenantCreditScoringService.computeCompositeScore(TENANT)
    const evaluation = await underwriting.evaluateApplication({
      applicationId: application.applicationId,
    })

    expect(credit.band).toMatch(/^[AB]$/)
    expect(evaluation.decision).toBe('APPROVE')
    expect(evaluation.creditScore?.score).toBe(credit.score)

    const traces = await underwritingDecisionTraceStore.findByApplicationId(application.applicationId)
    expect(traces).toHaveLength(1)
    expect(traces[0].decision).toBe('APPROVE')
  })

  it('auto-rejects weak profiles (D/F band)', async () => {
    weakOnboarding()
    const application = await tenantApplicationStore.create({
      userId: TENANT,
      propertyId: 2,
      annualRent: 1_200_000,
      deposit: 360_000,
      duration: 12,
      hasAgreedToTerms: true,
    })

    const credit = tenantCreditScoringService.computeCompositeScore(TENANT)
    expect(['D', 'F']).toContain(credit.band)

    const evaluation = await underwriting.evaluateApplication({
      applicationId: application.applicationId,
    })
    expect(evaluation.decision).toBe('REJECT')
  })
})
