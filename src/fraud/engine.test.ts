import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryFraudStore, initFraudStore } from './store.js'
import { FraudDetectionEngine, initFraudEngine } from './engine.js'
import {
  SignalType,
  RiskLevel,
  ActionType,
  EntityType,
  type CreateSignalInput,
  type AssessmentContext,
} from './types.js'

describe('FraudDetectionEngine - Focused Tests', () => {
  let store: InMemoryFraudStore
  let engine: FraudDetectionEngine

  beforeEach(() => {
    store = new InMemoryFraudStore()
    initFraudStore(store)
    engine = new FraudDetectionEngine()
    initFraudEngine(engine)
  })

  describe('Threshold Signal Evaluation - Table-Driven', () => {
    const thresholdTestCases = [
      {
        name: 'gt operator - above threshold triggers',
        config: { field: 'amount', operator: 'gt' as const, value: 1000 },
        eventData: { amount: 1500 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'gt operator - at threshold does not trigger',
        config: { field: 'amount', operator: 'gt' as const, value: 1000 },
        eventData: { amount: 1000 },
        expectedMatch: false,
        expectedScore: 0,
      },
      {
        name: 'gt operator - below threshold does not trigger',
        config: { field: 'amount', operator: 'gt' as const, value: 1000 },
        eventData: { amount: 500 },
        expectedMatch: false,
        expectedScore: 0,
      },
      {
        name: 'lt operator - below threshold triggers',
        config: { field: 'amount', operator: 'lt' as const, value: 100 },
        eventData: { amount: 50 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'lt operator - at threshold does not trigger',
        config: { field: 'amount', operator: 'lt' as const, value: 100 },
        eventData: { amount: 100 },
        expectedMatch: false,
        expectedScore: 0,
      },
      {
        name: 'eq operator - exact match triggers',
        config: { field: 'amount', operator: 'eq' as const, value: 500 },
        eventData: { amount: 500 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'eq operator - different value does not trigger',
        config: { field: 'amount', operator: 'eq' as const, value: 500 },
        eventData: { amount: 501 },
        expectedMatch: false,
        expectedScore: 0,
      },
      {
        name: 'gte operator - at threshold triggers',
        config: { field: 'amount', operator: 'gte' as const, value: 1000 },
        eventData: { amount: 1000 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'gte operator - above threshold triggers',
        config: { field: 'amount', operator: 'gte' as const, value: 1000 },
        eventData: { amount: 1500 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'lte operator - at threshold triggers',
        config: { field: 'amount', operator: 'lte' as const, value: 1000 },
        eventData: { amount: 1000 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'lte operator - below threshold triggers',
        config: { field: 'amount', operator: 'lte' as const, value: 1000 },
        eventData: { amount: 500 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'negative values - gt handles correctly',
        config: { field: 'balance', operator: 'gt' as const, value: -100 },
        eventData: { balance: -50 },
        expectedMatch: true,
        expectedScore: 10,
      },
      {
        name: 'zero values - eq handles correctly',
        config: { field: 'count', operator: 'eq' as const, value: 0 },
        eventData: { count: 0 },
        expectedMatch: true,
        expectedScore: 10,
      },
    ]

    thresholdTestCases.forEach(({ name, config, eventData, expectedMatch, expectedScore }) => {
      it(name, async () => {
        await store.createSignal({
          name: 'test-threshold',
          signalType: SignalType.THRESHOLD,
          config,
          scoreWeight: 10,
        })

        const context: AssessmentContext = {
          entityType: EntityType.PAYMENT,
          entityId: 'test-1',
          eventData,
        }

        const assessment = await engine.evaluate(context)

        expect(assessment.totalScore).toBe(expectedScore)
        expect(assessment.signalMatches.length).toBe(expectedMatch ? 1 : 0)
      })
    })
  })

  describe('Threshold Signal - Edge Cases', () => {
    it('handles missing field gracefully', async () => {
      await store.createSignal({
        name: 'missing-field',
        signalType: SignalType.THRESHOLD,
        config: { field: 'nonExistent', operator: 'gt', value: 100 },
        scoreWeight: 10,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'test-1',
        eventData: { amount: 500 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
      expect(assessment.signalMatches).toHaveLength(0)
    })

    it('handles non-numeric field value gracefully', async () => {
      await store.createSignal({
        name: 'non-numeric',
        signalType: SignalType.THRESHOLD,
        config: { field: 'amount', operator: 'gt', value: 100 },
        scoreWeight: 10,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'test-1',
        eventData: { amount: 'not-a-number' },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
      expect(assessment.signalMatches).toHaveLength(0)
    })

    it('handles nested field paths', async () => {
      await store.createSignal({
        name: 'nested-field',
        signalType: SignalType.THRESHOLD,
        config: { field: 'user.accountBalance', operator: 'gt', value: 1000 },
        scoreWeight: 10,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { user: { accountBalance: 1500 } },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(10)
      expect(assessment.signalMatches[0].details).toMatchObject({
        field: 'user.accountBalance',
        actualValue: 1500,
      })
    })
  })

  describe('Rule Signal Evaluation - Table-Driven', () => {
    const ruleTestCases = [
      {
        name: 'AND logic - all conditions match triggers',
        config: {
          conditions: [
            { field: 'country', operator: 'eq' as const, value: 'XX' },
            { field: 'amount', operator: 'gt' as const, value: 1000 },
          ],
          logic: 'AND' as const,
        },
        eventData: { country: 'XX', amount: 1500 },
        expectedMatch: true,
      },
      {
        name: 'AND logic - one condition fails does not trigger',
        config: {
          conditions: [
            { field: 'country', operator: 'eq' as const, value: 'XX' },
            { field: 'amount', operator: 'gt' as const, value: 1000 },
          ],
          logic: 'AND' as const,
        },
        eventData: { country: 'XX', amount: 500 },
        expectedMatch: false,
      },
      {
        name: 'OR logic - one condition matches triggers',
        config: {
          conditions: [
            { field: 'isVpn', operator: 'eq' as const, value: true },
            { field: 'isProxy', operator: 'eq' as const, value: true },
          ],
          logic: 'OR' as const,
        },
        eventData: { isVpn: true, isProxy: false },
        expectedMatch: true,
      },
      {
        name: 'OR logic - no conditions match does not trigger',
        config: {
          conditions: [
            { field: 'isVpn', operator: 'eq' as const, value: true },
            { field: 'isProxy', operator: 'eq' as const, value: true },
          ],
          logic: 'OR' as const,
        },
        eventData: { isVpn: false, isProxy: false },
        expectedMatch: false,
      },
      {
        name: 'neq operator - not equal triggers',
        config: {
          conditions: [{ field: 'status', operator: 'neq' as const, value: 'verified' }],
          logic: 'AND' as const,
        },
        eventData: { status: 'unverified' },
        expectedMatch: true,
      },
      {
        name: 'neq operator - equal does not trigger',
        config: {
          conditions: [{ field: 'status', operator: 'neq' as const, value: 'verified' }],
          logic: 'AND' as const,
        },
        eventData: { status: 'verified' },
        expectedMatch: false,
      },
      {
        name: 'contains operator - substring match triggers',
        config: {
          conditions: [{ field: 'email', operator: 'contains' as const, value: 'temp' }],
          logic: 'AND' as const,
        },
        eventData: { email: 'user@temp-mail.com' },
        expectedMatch: true,
      },
      {
        name: 'contains operator - no substring match does not trigger',
        config: {
          conditions: [{ field: 'email', operator: 'contains' as const, value: 'temp' }],
          logic: 'AND' as const,
        },
        eventData: { email: 'user@gmail.com' },
        expectedMatch: false,
      },
      {
        name: 'regex operator - pattern match triggers',
        config: {
          conditions: [{ field: 'ip', operator: 'regex' as const, value: '^192\\.168\\.' }],
          logic: 'AND' as const,
        },
        eventData: { ip: '192.168.1.1' },
        expectedMatch: true,
      },
      {
        name: 'default logic is AND when not specified',
        config: {
          conditions: [
            { field: 'flag1', operator: 'eq' as const, value: true },
            { field: 'flag2', operator: 'eq' as const, value: true },
          ],
        },
        eventData: { flag1: true, flag2: true },
        expectedMatch: true,
      },
    ]

    ruleTestCases.forEach(({ name, config, eventData, expectedMatch }) => {
      it(name, async () => {
        await store.createSignal({
          name: 'test-rule',
          signalType: SignalType.RULE,
          config,
          scoreWeight: 20,
        })

        const context: AssessmentContext = {
          entityType: EntityType.ACCOUNT,
          entityId: 'test-1',
          eventData,
        }

        const assessment = await engine.evaluate(context)

        expect(assessment.totalScore).toBe(expectedMatch ? 20 : 0)
        expect(assessment.signalMatches.length).toBe(expectedMatch ? 1 : 0)
      })
    })
  })

  describe('Rule Signal - Edge Cases', () => {
    it('handles missing field in condition gracefully', async () => {
      await store.createSignal({
        name: 'missing-field-rule',
        signalType: SignalType.RULE,
        config: {
          conditions: [{ field: 'nonExistent', operator: 'eq', value: 'test' }],
          logic: 'AND',
        },
        scoreWeight: 20,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { otherField: 'value' },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
    })

    it('handles empty conditions array', async () => {
      await store.createSignal({
        name: 'empty-conditions',
        signalType: SignalType.RULE,
        config: { conditions: [], logic: 'AND' },
        scoreWeight: 20,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: {},
      }

      const assessment = await engine.evaluate(context)

      // Empty conditions with AND logic should match (vacuously true)
      expect(assessment.totalScore).toBe(20)
    })
  })

  describe('Pattern Signal Evaluation - Table-Driven', () => {
    const patternTestCases = [
      {
        name: 'basic pattern match',
        config: { field: 'email', pattern: '.*@temp-mail\\.com$' },
        eventData: { email: 'user@temp-mail.com' },
        expectedMatch: true,
      },
      {
        name: 'pattern no match',
        config: { field: 'email', pattern: '.*@temp-mail\\.com$' },
        eventData: { email: 'user@gmail.com' },
        expectedMatch: false,
      },
      {
        name: 'pattern with case-insensitive flag',
        config: { field: 'email', pattern: '.*@TEMP-MAIL\\.COM$', flags: 'i' },
        eventData: { email: 'user@temp-mail.com' },
        expectedMatch: true,
      },
      {
        name: 'pattern for phone numbers',
        config: { field: 'phone', pattern: '^\\+?[1-9]\\d{1,14}$' },
        eventData: { phone: '+1234567890' },
        expectedMatch: true,
      },
      {
        name: 'pattern for IP addresses',
        config: { field: 'ip', pattern: '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$' },
        eventData: { ip: '192.168.1.1' },
        expectedMatch: true,
      },
      {
        name: 'pattern with special characters',
        config: { field: 'name', pattern: '^[a-zA-Z\\s]+$' },
        eventData: { name: 'John Doe' },
        expectedMatch: true,
      },
    ]

    patternTestCases.forEach(({ name, config, eventData, expectedMatch }) => {
      it(name, async () => {
        await store.createSignal({
          name: 'test-pattern',
          signalType: SignalType.PATTERN,
          config,
          scoreWeight: 15,
        })

        const context: AssessmentContext = {
          entityType: EntityType.ACCOUNT,
          entityId: 'test-1',
          eventData,
        }

        const assessment = await engine.evaluate(context)

        expect(assessment.totalScore).toBe(expectedMatch ? 15 : 0)
        expect(assessment.signalMatches.length).toBe(expectedMatch ? 1 : 0)
      })
    })
  })

  describe('Pattern Signal - Edge Cases', () => {
    it('handles non-string field value gracefully', async () => {
      await store.createSignal({
        name: 'non-string-pattern',
        signalType: SignalType.PATTERN,
        config: { field: 'amount', pattern: '^\\d+$' },
        scoreWeight: 15,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'test-1',
        eventData: { amount: 12345 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
    })

    it('handles missing field gracefully', async () => {
      await store.createSignal({
        name: 'missing-field-pattern',
        signalType: SignalType.PATTERN,
        config: { field: 'nonExistent', pattern: '.*' },
        scoreWeight: 15,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: {},
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
    })
  })

  describe('Risk Level Calculation - Boundary Tests', () => {
    it('LOW risk boundary (just below medium threshold)', async () => {
      await store.createSignal({
        name: 'low-boundary',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 29, // Default medium threshold is 30
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.LOW)
      expect(assessment.actionTaken).toBe(ActionType.NONE)
    })

    it('MEDIUM risk boundary (at medium threshold)', async () => {
      await store.createSignal({
        name: 'medium-boundary',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 30, // Default medium threshold is 30
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.MEDIUM)
      expect(assessment.actionTaken).toBe(ActionType.REVIEW_QUEUE)
    })

    it('HIGH risk boundary (at high threshold)', async () => {
      await store.createSignal({
        name: 'high-boundary',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 60, // Default high threshold is 60
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.HIGH)
      expect(assessment.actionTaken).toBe(ActionType.HOLD)
    })

    it('CRITICAL risk boundary (at critical threshold)', async () => {
      await store.createSignal({
        name: 'critical-boundary',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 90, // Default critical threshold is 90
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.riskLevel).toBe(RiskLevel.CRITICAL)
      expect(assessment.actionTaken).toBe(ActionType.BLOCK)
    })
  })

  describe('Score Aggregation - Multiple Signals', () => {
    it('sums scores from all matching signals', async () => {
      await store.createSignal({
        name: 'signal-1',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag1', operator: 'eq', value: true }] },
        scoreWeight: 20,
      })

      await store.createSignal({
        name: 'signal-2',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag2', operator: 'eq', value: true }] },
        scoreWeight: 25,
      })

      await store.createSignal({
        name: 'signal-3',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag3', operator: 'eq', value: true }] },
        scoreWeight: 15,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag1: true, flag2: true, flag3: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(60) // 20 + 25 + 15
      expect(assessment.signalMatches).toHaveLength(3)
      expect(assessment.riskLevel).toBe(RiskLevel.HIGH)
    })

    it('only includes matching signals in total score', async () => {
      await store.createSignal({
        name: 'matching-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 30,
      })

      await store.createSignal({
        name: 'non-matching-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: false }] },
        scoreWeight: 50,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(30)
      expect(assessment.signalMatches).toHaveLength(1)
    })

    it('handles zero matching signals', async () => {
      await store.createSignal({
        name: 'signal-1',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 30,
      })

      await store.createSignal({
        name: 'signal-2',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 40,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: false },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
      expect(assessment.signalMatches).toHaveLength(0)
      expect(assessment.riskLevel).toBe(RiskLevel.LOW)
    })
  })

  describe('Explainability - Signal Match Details', () => {
    it('includes threshold details in match', async () => {
      await store.createSignal({
        name: 'high-amount',
        signalType: SignalType.THRESHOLD,
        config: { field: 'amount', operator: 'gt', value: 1000 },
        scoreWeight: 25,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'test-1',
        eventData: { amount: 1500 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.signalMatches[0]).toMatchObject({
        signalName: 'high-amount',
        score: 25,
        details: {
          field: 'amount',
          operator: 'gt',
          threshold: 1000,
          actualValue: 1500,
        },
      })
    })

    it('includes rule condition results in match', async () => {
      await store.createSignal({
        name: 'multi-condition-rule',
        signalType: SignalType.RULE,
        config: {
          conditions: [
            { field: 'country', operator: 'eq', value: 'XX' },
            { field: 'amount', operator: 'gt', value: 1000 },
          ],
          logic: 'AND',
        },
        scoreWeight: 40,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'test-1',
        eventData: { country: 'XX', amount: 1500 },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.signalMatches[0]).toMatchObject({
        signalName: 'multi-condition-rule',
        score: 40,
        details: {
          conditions: [
            { field: 'country', operator: 'eq', value: 'XX' },
            { field: 'amount', operator: 'gt', value: 1000 },
          ],
          logic: 'AND',
          results: [true, true],
        },
      })
    })

    it('includes pattern match details in match', async () => {
      await store.createSignal({
        name: 'email-pattern',
        signalType: SignalType.PATTERN,
        config: { field: 'email', pattern: '.*@temp-mail\\.com$' },
        scoreWeight: 35,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { email: 'user@temp-mail.com' },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.signalMatches[0]).toMatchObject({
        signalName: 'email-pattern',
        score: 35,
        details: {
          field: 'email',
          pattern: '.*@temp-mail\\.com$',
          matchedValue: 'user@temp-mail.com',
        },
      })
    })

    it('identifies which signals fired in assessment', async () => {
      await store.createSignal({
        name: 'fired-signal-1',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag1', operator: 'eq', value: true }] },
        scoreWeight: 20,
      })

      await store.createSignal({
        name: 'fired-signal-2',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag2', operator: 'eq', value: true }] },
        scoreWeight: 25,
      })

      await store.createSignal({
        name: 'unfired-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag3', operator: 'eq', value: true }] },
        scoreWeight: 30,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag1: true, flag2: true, flag3: false },
      }

      const assessment = await engine.evaluate(context)

      const firedSignalNames = assessment.signalMatches.map(m => m.signalName)
      expect(firedSignalNames).toContain('fired-signal-1')
      expect(firedSignalNames).toContain('fired-signal-2')
      expect(firedSignalNames).not.toContain('unfired-signal')
    })
  })

  describe('Determinism', () => {
    it('produces identical results for identical inputs', async () => {
      await store.createSignal({
        name: 'test-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 30,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment1 = await engine.evaluate(context)
      const assessment2 = await engine.evaluate(context)

      expect(assessment1.totalScore).toBe(assessment2.totalScore)
      expect(assessment1.riskLevel).toBe(assessment2.riskLevel)
      expect(assessment1.actionTaken).toBe(assessment2.actionTaken)
      expect(assessment1.signalMatches).toEqual(assessment2.signalMatches)
    })

    it('produces identical results across multiple evaluations', async () => {
      await store.createSignal({
        name: 'signal-1',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag1', operator: 'eq', value: true }] },
        scoreWeight: 20,
      })

      await store.createSignal({
        name: 'signal-2',
        signalType: SignalType.THRESHOLD,
        config: { field: 'amount', operator: 'gt', value: 1000 },
        scoreWeight: 25,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'test-1',
        eventData: { flag1: true, amount: 1500 },
      }

      const assessments = await Promise.all([
        engine.evaluate(context),
        engine.evaluate(context),
        engine.evaluate(context),
      ])

      const firstAssessment = assessments[0]
      assessments.forEach(assessment => {
        expect(assessment.totalScore).toBe(firstAssessment.totalScore)
        expect(assessment.riskLevel).toBe(firstAssessment.riskLevel)
        expect(assessment.actionTaken).toBe(firstAssessment.actionTaken)
      })
    })
  })

  describe('Error Handling', () => {
    it('handles unknown signal type gracefully', async () => {
      // Create a signal with an invalid type by casting
      await store.createSignal({
        name: 'unknown-type',
        signalType: 'unknown' as SignalType,
        config: {},
        scoreWeight: 10,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: {},
      }

      // Should not throw, should just skip the signal
      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
      expect(assessment.signalMatches).toHaveLength(0)
    })

    it('handles evaluation errors without throwing', async () => {
      await store.createSignal({
        name: 'malformed-signal',
        signalType: SignalType.PATTERN,
        config: { field: 'email', pattern: '[invalid(' }, // Invalid regex
        scoreWeight: 10,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { email: 'test@example.com' },
      }

      // Should not throw, should just skip the signal
      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(0)
    })
  })

  describe('Disabled Signals', () => {
    it('does not evaluate disabled signals', async () => {
      await store.createSignal({
        name: 'disabled-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 50,
        enabled: false,
      })

      await store.createSignal({
        name: 'enabled-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 20,
        enabled: true,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.totalScore).toBe(20) // Only enabled signal
      expect(assessment.signalMatches).toHaveLength(1)
      expect(assessment.signalMatches[0].signalName).toBe('enabled-signal')
    })
  })

  describe('Custom Thresholds', () => {
    it('uses custom thresholds for risk calculation', async () => {
      const customEngine = new FraudDetectionEngine({
        medium: 20,
        high: 40,
        critical: 70,
      })
      initFraudEngine(customEngine)

      await store.createSignal({
        name: 'test-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 25,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      const assessment = await customEngine.evaluate(context)

      // With custom thresholds, 25 should be HIGH (medium: 20, high: 40)
      expect(assessment.riskLevel).toBe(RiskLevel.HIGH)
      expect(assessment.actionTaken).toBe(ActionType.HOLD)
    })

    it('allows threshold updates at runtime', async () => {
      await store.createSignal({
        name: 'test-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 35,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'test-1',
        eventData: { flag: true },
      }

      // First evaluation with default thresholds
      const assessment1 = await engine.evaluate(context)
      expect(assessment1.riskLevel).toBe(RiskLevel.MEDIUM)

      // Update thresholds
      engine.updateThresholds({ medium: 40 })

      // Second evaluation with updated thresholds
      const assessment2 = await engine.evaluate(context)
      expect(assessment2.riskLevel).toBe(RiskLevel.LOW)
    })
  })

  describe('Action Determination by Entity Type', () => {
    it('applies account hold for ACCOUNT entity with HIGH risk', async () => {
      await store.createSignal({
        name: 'high-risk-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 70,
      })

      const context: AssessmentContext = {
        entityType: EntityType.ACCOUNT,
        entityId: 'account-123',
        eventData: { flag: true },
      }

      await engine.evaluate(context)

      const holds = await store.getActiveHolds('account-123')
      expect(holds).toHaveLength(1)
      expect(holds[0].holdType).toBe('partial')
    })

    it('does not apply hold for non-ACCOUNT entities', async () => {
      await store.createSignal({
        name: 'high-risk-signal',
        signalType: SignalType.RULE,
        config: { conditions: [{ field: 'flag', operator: 'eq', value: true }] },
        scoreWeight: 70,
      })

      const context: AssessmentContext = {
        entityType: EntityType.PAYMENT,
        entityId: 'payment-123',
        eventData: { flag: true },
      }

      const assessment = await engine.evaluate(context)

      expect(assessment.actionTaken).toBe(ActionType.HOLD)
      // No hold should be created for non-ACCOUNT entities
      const holds = await store.getActiveHolds('payment-123')
      expect(holds).toHaveLength(0)
    })
  })
})
