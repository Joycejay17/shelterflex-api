/**
 * Deal State Machine Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DealStateMachine } from "./DealStateMachine";
import { DealStatus } from "../../models/deal";

describe("DealStateMachine", () => {
  let stateMachine: DealStateMachine;

  beforeEach(() => {
    stateMachine = new DealStateMachine();
    vi.mock("../repositories/AuditRepository");
    vi.mock("../outbox/index");
  });

  describe("Valid Transitions", () => {
    it("should allow draft to active", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.DRAFT,
        DealStatus.ACTIVE,
      );
      expect(valid).toBe(true);
    });

    it("should allow active to completed", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.ACTIVE,
        DealStatus.COMPLETED,
      );
      expect(valid).toBe(true);
    });

    it("should allow active to defaulted", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.ACTIVE,
        DealStatus.DEFAULTED,
      );
      expect(valid).toBe(true);
    });
  });

  describe("Invalid Transitions", () => {
    it("should not allow draft to completed", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.DRAFT,
        DealStatus.COMPLETED,
      );
      expect(valid).toBe(false);
    });

    it("should not allow draft to defaulted", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.DRAFT,
        DealStatus.DEFAULTED,
      );
      expect(valid).toBe(false);
    });

    it("should not allow completed to active", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.COMPLETED,
        DealStatus.ACTIVE,
      );
      expect(valid).toBe(false);
    });

    it("should not allow defaulted to active", () => {
      const valid = stateMachine.isValidTransition(
        DealStatus.DEFAULTED,
        DealStatus.ACTIVE,
      );
      expect(valid).toBe(false);
    });
  });

  describe("Get Valid Transitions", () => {
    it("should return correct transitions for draft", () => {
      const transitions = stateMachine.getValidTransitions(DealStatus.DRAFT);
      expect(transitions).toEqual([DealStatus.ACTIVE]);
    });

    it("should return correct transitions for active", () => {
      const transitions = stateMachine.getValidTransitions(DealStatus.ACTIVE);
      expect(transitions).toContain(DealStatus.COMPLETED);
      expect(transitions).toContain(DealStatus.DEFAULTED);
    });

    it("should return no transitions for completed", () => {
      const transitions = stateMachine.getValidTransitions(
        DealStatus.COMPLETED,
      );
      expect(transitions).toEqual([]);
    });
  });
});
