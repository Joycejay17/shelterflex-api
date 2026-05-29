/**
 * Escrow condition model & release-policy evaluation — issue #910.
 *
 * Models the conditions that gate an automated escrow release for a deal, and
 * the policy that decides when the gate opens. The evaluation logic
 * (`evaluateRelease`) is pure so it can be driven from condition-satisfaction
 * hooks and from the scheduled release job alike.
 */

import { randomUUID } from 'node:crypto'

export type EscrowConditionType =
  | 'lease_signed'
  | 'inspection_approved'
  | 'instalment_received'
  | 'admin_override'

export type EscrowReleaseMode = 'all_satisfied' | 'any_satisfied' | 'admin_manual'

export interface EscrowCondition {
  id: string
  dealId: string
  conditionType: EscrowConditionType
  /** For `instalment_received`: which instalment this condition tracks. */
  instalmentNumber?: number
  satisfied: boolean
  satisfiedAt?: string
  satisfiedBy?: string
}

export interface EscrowReleasePolicy {
  dealId: string
  requiredConditions: EscrowConditionType[]
  releaseMode: EscrowReleaseMode
}

export interface ReleaseEvaluation {
  shouldRelease: boolean
  satisfiedConditions: EscrowConditionType[]
  missingConditions: EscrowConditionType[]
  reason: string
}

/**
 * Is a condition of `conditionType` satisfied for the deal? When
 * `instalmentNumber` is provided, the match is scoped to that instalment.
 */
export function isConditionSatisfied(
  conditions: EscrowCondition[],
  conditionType: EscrowConditionType,
  instalmentNumber?: number,
): boolean {
  return conditions.some(
    (c) =>
      c.conditionType === conditionType &&
      c.satisfied &&
      (instalmentNumber === undefined || c.instalmentNumber === instalmentNumber),
  )
}

/**
 * Pure release decision. An admin override always opens the gate regardless of
 * the policy mode. Otherwise:
 *   - admin_manual:  released only by an admin override.
 *   - all_satisfied: every required condition must be satisfied.
 *   - any_satisfied: at least one required condition must be satisfied.
 */
export function evaluateRelease(
  policy: EscrowReleasePolicy,
  conditions: EscrowCondition[],
): ReleaseEvaluation {
  const required = policy.requiredConditions
  const satisfiedConditions = required.filter((t) => isConditionSatisfied(conditions, t))
  const missingConditions = required.filter((t) => !isConditionSatisfied(conditions, t))

  const adminOverride = isConditionSatisfied(conditions, 'admin_override')
  if (adminOverride) {
    return {
      shouldRelease: true,
      satisfiedConditions,
      missingConditions,
      reason: 'admin_override',
    }
  }

  let shouldRelease: boolean
  let reason: string
  switch (policy.releaseMode) {
    case 'admin_manual':
      shouldRelease = false
      reason = 'awaiting_admin_override'
      break
    case 'any_satisfied':
      shouldRelease = satisfiedConditions.length > 0
      reason = shouldRelease ? 'any_condition_satisfied' : 'no_conditions_satisfied'
      break
    case 'all_satisfied':
    default:
      shouldRelease = required.length > 0 && missingConditions.length === 0
      reason = shouldRelease ? 'all_conditions_satisfied' : 'conditions_outstanding'
      break
  }

  return { shouldRelease, satisfiedConditions, missingConditions, reason }
}

/**
 * In-memory store for escrow conditions. Marking a condition satisfied is
 * idempotent: re-applying the same satisfaction does not create a duplicate
 * record nor move the original `satisfiedAt` timestamp.
 */
export class InMemoryEscrowConditionStore {
  private conditions: Map<string, EscrowCondition> = new Map()

  private keyFor(dealId: string, type: EscrowConditionType, instalmentNumber?: number): string {
    return `${dealId}:${type}:${instalmentNumber ?? '-'}`
  }

  listByDeal(dealId: string): EscrowCondition[] {
    return Array.from(this.conditions.values()).filter((c) => c.dealId === dealId)
  }

  markSatisfied(params: {
    dealId: string
    conditionType: EscrowConditionType
    instalmentNumber?: number
    satisfiedBy?: string
    satisfiedAt?: string
  }): EscrowCondition {
    const key = this.keyFor(params.dealId, params.conditionType, params.instalmentNumber)
    const existing = this.conditions.get(key)
    if (existing && existing.satisfied) {
      return existing
    }
    const condition: EscrowCondition = {
      id: existing?.id ?? randomUUID(),
      dealId: params.dealId,
      conditionType: params.conditionType,
      instalmentNumber: params.instalmentNumber,
      satisfied: true,
      satisfiedAt: params.satisfiedAt ?? new Date().toISOString(),
      satisfiedBy: params.satisfiedBy,
    }
    this.conditions.set(key, condition)
    return condition
  }
}
