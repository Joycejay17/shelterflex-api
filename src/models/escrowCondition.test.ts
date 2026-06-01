import { describe, it, expect } from 'vitest'
import {
  evaluateRelease,
  isConditionSatisfied,
  InMemoryEscrowConditionStore,
  type EscrowCondition,
  type EscrowReleasePolicy,
} from './escrowCondition.js'

function condition(
  dealId: string,
  conditionType: EscrowCondition['conditionType'],
  satisfied: boolean,
  instalmentNumber?: number,
): EscrowCondition {
  return { id: `${conditionType}-${instalmentNumber ?? 0}`, dealId, conditionType, satisfied, instalmentNumber }
}

describe('evaluateRelease — all_satisfied', () => {
  const policy: EscrowReleasePolicy = {
    dealId: 'deal-1',
    requiredConditions: ['lease_signed', 'inspection_approved'],
    releaseMode: 'all_satisfied',
  }

  it('does not release until every required condition is satisfied', () => {
    const partial = evaluateRelease(policy, [
      condition('deal-1', 'lease_signed', true),
      condition('deal-1', 'inspection_approved', false),
    ])
    expect(partial.shouldRelease).toBe(false)
    expect(partial.missingConditions).toEqual(['inspection_approved'])
    expect(partial.reason).toBe('conditions_outstanding')
  })

  it('releases once all required conditions are satisfied', () => {
    const full = evaluateRelease(policy, [
      condition('deal-1', 'lease_signed', true),
      condition('deal-1', 'inspection_approved', true),
    ])
    expect(full.shouldRelease).toBe(true)
    expect(full.missingConditions).toEqual([])
    expect(full.reason).toBe('all_conditions_satisfied')
  })
})

describe('evaluateRelease — any_satisfied', () => {
  const policy: EscrowReleasePolicy = {
    dealId: 'deal-2',
    requiredConditions: ['instalment_received', 'inspection_approved'],
    releaseMode: 'any_satisfied',
  }

  it('releases when at least one condition is satisfied', () => {
    const result = evaluateRelease(policy, [condition('deal-2', 'instalment_received', true, 1)])
    expect(result.shouldRelease).toBe(true)
    expect(result.reason).toBe('any_condition_satisfied')
  })

  it('does not release when none are satisfied', () => {
    const result = evaluateRelease(policy, [])
    expect(result.shouldRelease).toBe(false)
    expect(result.reason).toBe('no_conditions_satisfied')
  })
})

describe('evaluateRelease — admin override', () => {
  it('admin_manual policy only releases on admin override', () => {
    const policy: EscrowReleasePolicy = {
      dealId: 'deal-3',
      requiredConditions: ['lease_signed'],
      releaseMode: 'admin_manual',
    }
    expect(evaluateRelease(policy, [condition('deal-3', 'lease_signed', true)]).shouldRelease).toBe(false)
    const overridden = evaluateRelease(policy, [
      condition('deal-3', 'lease_signed', true),
      condition('deal-3', 'admin_override', true),
    ])
    expect(overridden.shouldRelease).toBe(true)
    expect(overridden.reason).toBe('admin_override')
  })

  it('admin override forces release even under all_satisfied with missing conditions', () => {
    const policy: EscrowReleasePolicy = {
      dealId: 'deal-4',
      requiredConditions: ['lease_signed', 'inspection_approved'],
      releaseMode: 'all_satisfied',
    }
    const result = evaluateRelease(policy, [condition('deal-4', 'admin_override', true)])
    expect(result.shouldRelease).toBe(true)
    expect(result.reason).toBe('admin_override')
  })
})

describe('isConditionSatisfied — per-instalment scoping', () => {
  it('matches the specific instalment for partial release', () => {
    const conditions = [
      condition('deal-5', 'instalment_received', true, 1),
      condition('deal-5', 'instalment_received', false, 2),
    ]
    expect(isConditionSatisfied(conditions, 'instalment_received', 1)).toBe(true)
    expect(isConditionSatisfied(conditions, 'instalment_received', 2)).toBe(false)
  })
})

describe('InMemoryEscrowConditionStore', () => {
  it('marks conditions satisfied and lists them by deal', () => {
    const store = new InMemoryEscrowConditionStore()
    store.markSatisfied({ dealId: 'deal-6', conditionType: 'lease_signed', satisfiedBy: 'system' })
    const list = store.listByDeal('deal-6')
    expect(list).toHaveLength(1)
    expect(list[0].satisfied).toBe(true)
    expect(list[0].satisfiedBy).toBe('system')
  })

  it('is idempotent: re-marking does not duplicate or reset the timestamp', () => {
    const store = new InMemoryEscrowConditionStore()
    const first = store.markSatisfied({
      dealId: 'deal-7',
      conditionType: 'instalment_received',
      instalmentNumber: 1,
      satisfiedAt: '2026-01-01T00:00:00.000Z',
    })
    const second = store.markSatisfied({
      dealId: 'deal-7',
      conditionType: 'instalment_received',
      instalmentNumber: 1,
      satisfiedAt: '2026-02-02T00:00:00.000Z',
    })
    expect(store.listByDeal('deal-7')).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(second.satisfiedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('tracks distinct instalments separately', () => {
    const store = new InMemoryEscrowConditionStore()
    store.markSatisfied({ dealId: 'deal-8', conditionType: 'instalment_received', instalmentNumber: 1 })
    store.markSatisfied({ dealId: 'deal-8', conditionType: 'instalment_received', instalmentNumber: 2 })
    expect(store.listByDeal('deal-8')).toHaveLength(2)
  })
})
