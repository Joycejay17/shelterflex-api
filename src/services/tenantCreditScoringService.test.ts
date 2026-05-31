import { describe, it, expect, beforeEach } from 'vitest'
import { TenantCreditScoringService, hasNsfMarker } from './tenantCreditScoringService.js'
import { tenantOnboardingDataStore } from '../models/tenantOnboardingDataStore.js'
import { tenantCreditScoreStore } from '../models/tenantCreditScoreStore.js'
import { DEFAULT_CREDIT_SCORING_CONFIG } from '../config/creditScoring.js'
import { analyzeBankStatement } from './bankStatementAnalysis.js'

const TENANT = 'tenant-score-unit'

function seedOnboarding(overrides: Partial<Parameters<typeof tenantOnboardingDataStore.upsert>[1]> = {}) {
  tenantOnboardingDataStore.upsert(TENANT, {
    statedMonthlyIncome: 300_000,
    monthlyRent: 80_000,
    employmentStatus: 'employed',
    employerName: 'Acme Corp',
    employmentProofText: 'Letter from Acme Corp confirming employment',
    bankStatementLines: [
      { date: '2026-01-15', description: 'Salary payroll', amount: 290_000 },
      { date: '2026-02-15', description: 'Salary payroll', amount: 295_000 },
      { date: '2026-03-15', description: 'Salary payroll', amount: 300_000 },
      { date: '2026-02-20', description: 'Loan EMI repayment', amount: -50_000 },
    ],
    mobileMoneyTransactions: [
      { date: '2026-01-10', amount: 20_000, type: 'credit' },
      { date: '2026-02-10', amount: 25_000, type: 'credit' },
      { date: '2026-03-10', amount: 30_000, type: 'credit' },
    ],
    ...overrides,
  })
}

describe('TenantCreditScoringService', () => {
  let service: TenantCreditScoringService

  beforeEach(() => {
    tenantOnboardingDataStore.clear()
    tenantCreditScoreStore.clear()
    service = new TenantCreditScoringService(DEFAULT_CREDIT_SCORING_CONFIG)
  })

  describe('scoreIncome', () => {
    it('scores higher when bank credits align with stated income and rent is affordable', () => {
      seedOnboarding()
      expect(service.scoreIncome(TENANT)).toBeGreaterThan(60)
    })

    it('returns 0 when onboarding data is missing', () => {
      expect(service.scoreIncome('unknown')).toBe(0)
    })
  })

  describe('scoreEmployment', () => {
    it('scores higher when employer appears in proof text', () => {
      seedOnboarding()
      expect(service.scoreEmployment(TENANT)).toBeGreaterThan(70)
    })

    it('scores low for unemployed status', () => {
      seedOnboarding({ employmentStatus: 'unemployed', employmentProofText: '' })
      expect(service.scoreEmployment(TENANT)).toBeLessThanOrEqual(15)
    })
  })

  describe('scoreBankStatement', () => {
    it('detects NSF markers and reduces score', () => {
      seedOnboarding({
        bankStatementLines: [
          { date: '2026-01-10', description: 'NSF insufficient funds', amount: -500 },
          { date: '2026-02-10', description: 'Salary payroll', amount: 200_000 },
        ],
      })
      const withNsf = service.scoreBankStatement(TENANT)
      tenantOnboardingDataStore.clear()
      tenantOnboardingDataStore.upsert(TENANT, {
        statedMonthlyIncome: 300_000,
        monthlyRent: 80_000,
        employmentStatus: 'employed',
        employerName: 'Acme',
        bankStatementLines: [
          { date: '2026-01-10', description: 'Salary payroll', amount: 200_000 },
          { date: '2026-02-10', description: 'Salary payroll', amount: 210_000 },
        ],
      })
      expect(withNsf).toBeLessThan(service.scoreBankStatement(TENANT))
    })
  })

  describe('scoreAlternativeData', () => {
    it('returns null when mobile money data is not provided', () => {
      seedOnboarding({ mobileMoneyTransactions: undefined })
      expect(service.scoreAlternativeData(TENANT)).toBeNull()
    })

    it('returns a score when mobile money transactions exist', () => {
      seedOnboarding()
      expect(service.scoreAlternativeData(TENANT)).toBeGreaterThan(0)
    })
  })

  describe('computeCompositeScore', () => {
    it('stores composite score and band', () => {
      seedOnboarding()
      const result = service.computeCompositeScore(TENANT)
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(1000)
      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.band)
      expect(result.computedAt).toBeInstanceOf(Date)
      expect(result.version).toBe(DEFAULT_CREDIT_SCORING_CONFIG.version)
    })

    it('is idempotent for the same tenant data version', () => {
      seedOnboarding()
      const first = service.computeCompositeScore(TENANT)
      const second = service.computeCompositeScore(TENANT)
      expect(second.id).toBe(first.id)
      expect(second.score).toBe(first.score)
    })

    it('handles missing alternative data by redistributing weights', () => {
      seedOnboarding({ mobileMoneyTransactions: undefined })
      const result = service.computeCompositeScore(TENANT)
      expect(result.alternativeDataScore).toBeNull()
      expect(result.score).toBeGreaterThan(0)
    })
  })
})

describe('hasNsfMarker', () => {
  it('matches common NSF description patterns', () => {
    expect(hasNsfMarker('NSF fee charged')).toBe(true)
    expect(hasNsfMarker('Returned item - insufficient funds')).toBe(true)
    expect(hasNsfMarker('Salary credit')).toBe(false)
  })
})

describe('analyzeBankStatement', () => {
  it('counts income credits and NSF events', () => {
    const analysis = analyzeBankStatement([
      { date: '2026-01-01', description: 'Salary payroll', amount: 100_000 },
      { date: '2026-02-01', description: 'bounced check', amount: -1000 },
    ])
    expect(analysis.incomeCreditCount).toBeGreaterThanOrEqual(1)
    expect(analysis.nsfCount).toBeGreaterThanOrEqual(1)
  })
})
