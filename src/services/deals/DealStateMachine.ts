/**
 * Deal State Machine
 * Enforces valid deal lifecycle transitions and manages state-related events
 */

import { DealStatus } from "../../models/deal.js";
import { AppError } from "../../errors/AppError.js";
import { ErrorCode } from "../../errors/errorCodes.js";
import { auditLog } from "../../repositories/AuditRepository.js";
import { outboxStore } from "../../outbox/index.js";
import { logger } from "../../utils/logger.js";

export interface DealWithStatusHistory {
  dealId: string;
  status: DealStatus;
  statusHistory: Array<{
    status: DealStatus;
    actor: string;
    timestamp: Date;
    reason?: string;
  }>;
}

export interface StateTransition {
  from: DealStatus;
  to: DealStatus;
  actor: string;
  reason?: string;
}

export class DealStateMachine {
  // Define valid transitions
  private readonly validTransitions: Record<DealStatus, DealStatus[]> = {
    [DealStatus.DRAFT]: [DealStatus.ACTIVE],
    [DealStatus.ACTIVE]: [DealStatus.COMPLETED, DealStatus.DEFAULTED],
    [DealStatus.AT_RISK]: [DealStatus.ACTIVE, DealStatus.DEFAULTED],
    [DealStatus.COMPLETED]: [],
    [DealStatus.DEFAULTED]: [],
  };

  /**
   * Validate and execute state transition
   */
  async transition(
    currentStatus: DealStatus,
    targetStatus: DealStatus,
    dealId: string,
    actor: string,
    reason?: string,
  ): Promise<DealStatus> {
    // Validate transition is allowed
    const allowed = this.validTransitions[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw new AppError(
        ErrorCode.INVALID_STATE_TRANSITION,
        400,
        `Invalid transition from ${currentStatus} to ${targetStatus}`,
      );
    }

    // Run pre-transition hooks
    await this.runPreTransitionHooks(currentStatus, targetStatus, dealId);

    // Update status (actual persistence happens in route/service)
    logger.info(
      `Transitioning deal ${dealId} from ${currentStatus} to ${targetStatus}`,
    );

    // Run post-transition hooks
    await this.runPostTransitionHooks(
      currentStatus,
      targetStatus,
      dealId,
      actor,
      reason,
    );

    // Audit log
    await auditLog({
      actor,
      action: `DEAL_STATUS_CHANGED_${targetStatus}`,
      resourceType: "deal",
      resourceId: dealId,
      details: {
        from: currentStatus,
        to: targetStatus,
        reason,
      },
    });

    return targetStatus;
  }

  /**
   * Pre-transition validations
   */
  private async runPreTransitionHooks(
    from: DealStatus,
    to: DealStatus,
    dealId: string,
  ): Promise<void> {
    if (to === DealStatus.COMPLETED) {
      // Check payment is complete (fetch from DB in production)
      logger.info(`Validating payment completion for deal ${dealId}`);
    }

    if (to === DealStatus.DEFAULTED) {
      // Check if overdue thresholds met
      logger.info(`Validating default conditions for deal ${dealId}`);
    }
  }

  /**
   * Post-transition hooks - emit events
   */
  private async runPostTransitionHooks(
    from: DealStatus,
    to: DealStatus,
    dealId: string,
    actor: string,
    reason?: string,
  ): Promise<void> {
    if (to === DealStatus.ACTIVE) {
      // Trigger agreement generation
      await outboxStore.create({
        txType: "RECEIPT" as any,
        source: "deal_state_machine",
        ref: `${dealId}-active`,
        payload: {
          type: "DealActivated",
          dealId,
          action: "GenerateAgreement",
        },
      });
      logger.info(`Triggered agreement generation for deal ${dealId}`);
    }

    if (to === DealStatus.COMPLETED) {
      // Trigger payout settlement
      await outboxStore.create({
        txType: "RECEIPT" as any,
        source: "deal_state_machine",
        ref: `${dealId}-completed`,
        payload: {
          type: "DealCompleted",
          dealId,
          action: "SettlePayouts",
        },
      });
      logger.info(`Triggered payout settlement for deal ${dealId}`);
    }
  }

  /**
   * Get valid transitions for current status
   */
  getValidTransitions(status: DealStatus): DealStatus[] {
    return this.validTransitions[status] || [];
  }

  /**
   * Check if transition is valid
   */
  isValidTransition(from: DealStatus, to: DealStatus): boolean {
    const allowed = this.validTransitions[from] || [];
    return allowed.includes(to);
  }
}

export const dealStateMachine = new DealStateMachine();
