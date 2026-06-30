import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CreditScoreService } from "./creditScoreService.js";
import { creditScoreSnapshotStore } from "../models/creditScoreSnapshot.js";
import type { UnderwritingResult } from "./underwritingRuleEngine.js";

describe("CreditScoreService", () => {
  let service: CreditScoreService;

  beforeEach(async () => {
    service = new CreditScoreService();
    await creditScoreSnapshotStore.clear();
  });

  afterEach(async () => {
    await creditScoreSnapshotStore.clear();
  });

  describe("recordUnderwritingSnapshot", () => {
    it("should compute deterministic score from underwriting result", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 85,
        maxScore: 100,
        decisionReason: "All checks passed",
        evaluatedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
        triggeredRules: [
          {
            ruleId: "deposit_minimum",
            passed: true,
            score: 20,
            weight: 20,
            reason: "Deposit meets minimum",
          },
          {
            ruleId: "income_sufficient",
            passed: true,
            score: 30,
            weight: 30,
            reason: "Income is sufficient",
          },
          {
            ruleId: "payment_history_good",
            passed: true,
            score: 35,
            weight: 35,
            reason: "Good payment history",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.userId).toBe("user-1");
      expect(snapshot.score).toBe(85);
      expect(snapshot.band).toBe("excellent");
      expect(snapshot.factors).toHaveLength(3);
      expect(snapshot.computedAt).toEqual(new Date("2024-01-15T10:00:00Z"));
    });

    it("should normalize score to 0-100 range", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 120,
        maxScore: 150,
        decisionReason: "Approved",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.score).toBe(80);
      expect(snapshot.score).toBeGreaterThanOrEqual(0);
      expect(snapshot.score).toBeLessThanOrEqual(100);
    });

    it("should handle zero max score gracefully", async () => {
      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: 0,
        maxScore: 0,
        decisionReason: "No applicable rules",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.score).toBe(0);
    });

    it("should map passed rules to pass status", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 50,
        maxScore: 100,
        decisionReason: "Approved",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "rule_1",
            passed: true,
            score: 50,
            weight: 50,
            reason: "Passed",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.factors[0]?.status).toBe("pass");
    });

    it("should map failed rules with zero score to fail status", async () => {
      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: 0,
        maxScore: 100,
        decisionReason: "Failed",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "rule_1",
            passed: false,
            score: 0,
            weight: 50,
            reason: "Failed",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.factors[0]?.status).toBe("fail");
    });

    it("should map failed rules with partial score to warn status", async () => {
      const result: UnderwritingResult = {
        decision: "REVIEW",
        totalScore: 20,
        maxScore: 100,
        decisionReason: "Needs review",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "rule_1",
            passed: false,
            score: 20,
            weight: 50,
            reason: "Partial score",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.factors[0]?.status).toBe("warn");
    });

    it("should produce identical snapshots for identical inputs", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 75,
        maxScore: 100,
        decisionReason: "Approved",
        evaluatedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
        triggeredRules: [
          {
            ruleId: "test_rule",
            passed: true,
            score: 75,
            weight: 75,
            reason: "Test",
          },
        ],
      };

      const snapshot1 = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      await creditScoreSnapshotStore.clear();
      const snapshot2 = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot1.score).toBe(snapshot2.score);
      expect(snapshot1.band).toBe(snapshot2.band);
      expect(snapshot1.factors).toEqual(snapshot2.factors);
    });
  });

  describe("getLatestSnapshot", () => {
    it("should retrieve latest snapshot for user", async () => {
      const result1: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 60,
        maxScore: 100,
        decisionReason: "First",
        evaluatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
        triggeredRules: [],
      };

      const result2: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 80,
        maxScore: 100,
        decisionReason: "Second",
        evaluatedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
        triggeredRules: [],
      };

      await service.recordUnderwritingSnapshot("user-1", result1);
      await service.recordUnderwritingSnapshot("user-1", result2);

      const latest = await service.getLatestSnapshot("user-1");

      expect(latest).not.toBeNull();
      expect(latest?.score).toBe(80);
      expect(latest?.computedAt).toEqual(new Date("2024-01-15T10:00:00Z"));
    });

    it("should return null for user with no snapshots", async () => {
      const latest = await service.getLatestSnapshot("nonexistent-user");

      expect(latest).toBeNull();
    });

    it("should isolate snapshots by user", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 70,
        maxScore: 100,
        decisionReason: "Approved",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      await service.recordUnderwritingSnapshot("user-1", result);
      await service.recordUnderwritingSnapshot("user-2", result);

      const latest1 = await service.getLatestSnapshot("user-1");
      const latest2 = await service.getLatestSnapshot("user-2");

      expect(latest1?.userId).toBe("user-1");
      expect(latest2?.userId).toBe("user-2");
    });
  });

  describe("getHistory", () => {
    it("should retrieve snapshot history in reverse chronological order", async () => {
      const dates = [
        "2024-01-01",
        "2024-01-15",
        "2024-02-01",
        "2024-02-15",
        "2024-03-01",
      ];

      for (const date of dates) {
        const result: UnderwritingResult = {
          decision: "APPROVE",
          totalScore: 70,
          maxScore: 100,
          decisionReason: "Approved",
          evaluatedAt: new Date(`${date}T10:00:00Z`).toISOString(),
          triggeredRules: [],
        };
        await service.recordUnderwritingSnapshot("user-1", result);
      }

      const history = await service.getHistory("user-1");

      expect(history).toHaveLength(5);
      expect(history[0]?.computedAt).toEqual(new Date("2024-03-01T10:00:00Z"));
      expect(history[4]?.computedAt).toEqual(new Date("2024-01-01T10:00:00Z"));
    });

    it("should limit history to requested count", async () => {
      for (let i = 0; i < 15; i++) {
        const day = String(i + 1).padStart(2, "0");
        const result: UnderwritingResult = {
          decision: "APPROVE",
          totalScore: 70,
          maxScore: 100,
          decisionReason: "Approved",
          evaluatedAt: new Date(`2024-01-${day}T10:00:00Z`).toISOString(),
          triggeredRules: [],
        };
        await service.recordUnderwritingSnapshot("user-1", result);
      }

      const history = await service.getHistory("user-1");

      expect(history.length).toBeLessThanOrEqual(12);
    });

    it("should return empty array for user with no history", async () => {
      const history = await service.getHistory("nonexistent-user");

      expect(history).toEqual([]);
    });
  });

  describe("generateImprovementTips", () => {
    it("should generate tips from failed factors", async () => {
      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: 30,
        maxScore: 100,
        decisionReason: "Failed",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "deposit_minimum",
            passed: false,
            score: 0,
            weight: 30,
            reason: "Deposit too low",
          },
          {
            ruleId: "income_sufficient",
            passed: false,
            score: 0,
            weight: 40,
            reason: "Income insufficient",
          },
          {
            ruleId: "payment_history_good",
            passed: true,
            score: 30,
            weight: 30,
            reason: "Good history",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      const tips = service.generateImprovementTips(snapshot);

      expect(tips.length).toBeGreaterThan(0);
      expect(tips.length).toBeLessThanOrEqual(3);
      expect(tips[0]).toContain("Improve");
    });

    it("should prioritize tips by weight", async () => {
      const result: UnderwritingResult = {
        decision: "REVIEW",
        totalScore: 50,
        maxScore: 100,
        decisionReason: "Review",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "low_weight_rule",
            passed: false,
            score: 0,
            weight: 10,
            reason: "Minor issue",
          },
          {
            ruleId: "high_weight_rule",
            passed: false,
            score: 0,
            weight: 50,
            reason: "Major issue",
          },
          {
            ruleId: "medium_weight_rule",
            passed: false,
            score: 0,
            weight: 30,
            reason: "Medium issue",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      const tips = service.generateImprovementTips(snapshot);

      expect(tips[0]).toContain("high weight rule");
    });

    it("should limit tips to top 3 factors", async () => {
      const triggeredRules = [];
      for (let i = 0; i < 10; i++) {
        triggeredRules.push({
          ruleId: `rule_${i}`,
          passed: false,
          score: 0,
          weight: 10,
          reason: `Issue ${i}`,
        });
      }

      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: 0,
        maxScore: 100,
        decisionReason: "Failed",
        evaluatedAt: new Date().toISOString(),
        triggeredRules,
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      const tips = service.generateImprovementTips(snapshot);

      expect(tips).toHaveLength(3);
    });

    it("should handle warnings differently from failures", async () => {
      const result: UnderwritingResult = {
        decision: "REVIEW",
        totalScore: 40,
        maxScore: 100,
        decisionReason: "Review",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "warning_rule",
            passed: false,
            score: 20,
            weight: 30,
            reason: "Warning",
          },
          {
            ruleId: "failed_rule",
            passed: false,
            score: 0,
            weight: 40,
            reason: "Failed",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      const tips = service.generateImprovementTips(snapshot);

      expect(tips.some((tip) => tip.includes("Strengthen"))).toBe(true);
      expect(tips.some((tip) => tip.includes("Improve"))).toBe(true);
    });

    it("should return empty array when all factors pass", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 100,
        maxScore: 100,
        decisionReason: "Perfect",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "rule_1",
            passed: true,
            score: 100,
            weight: 100,
            reason: "Perfect",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      const tips = service.generateImprovementTips(snapshot);

      expect(tips).toEqual([]);
    });

    it("should format factor names for readability", async () => {
      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: 0,
        maxScore: 100,
        decisionReason: "Failed",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [
          {
            ruleId: "payment_history_good",
            passed: false,
            score: 0,
            weight: 50,
            reason: "Poor payment history",
          },
        ],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );
      const tips = service.generateImprovementTips(snapshot);

      expect(tips[0]).toContain("payment history good");
      expect(tips[0]).not.toContain("payment_history_good");
    });
  });

  describe("score bounds enforcement", () => {
    it("should enforce minimum score of 0", async () => {
      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: -50,
        maxScore: 100,
        decisionReason: "Negative",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.score).toBe(0);
    });

    it("should enforce maximum score of 100", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 150,
        maxScore: 100,
        decisionReason: "Over max",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.score).toBe(100);
    });

    it("should round fractional scores", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 67,
        maxScore: 100,
        decisionReason: "Approved",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(Number.isInteger(snapshot.score)).toBe(true);
    });
  });

  describe("band assignment", () => {
    it("should assign poor band for low scores", async () => {
      const result: UnderwritingResult = {
        decision: "REJECT",
        totalScore: 30,
        maxScore: 100,
        decisionReason: "Low score",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.band).toBe("poor");
    });

    it("should assign fair band for mid-low scores", async () => {
      const result: UnderwritingResult = {
        decision: "REVIEW",
        totalScore: 50,
        maxScore: 100,
        decisionReason: "Fair score",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.band).toBe("fair");
    });

    it("should assign good band for mid-high scores", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 70,
        maxScore: 100,
        decisionReason: "Good score",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.band).toBe("good");
    });

    it("should assign excellent band for high scores", async () => {
      const result: UnderwritingResult = {
        decision: "APPROVE",
        totalScore: 85,
        maxScore: 100,
        decisionReason: "Excellent score",
        evaluatedAt: new Date().toISOString(),
        triggeredRules: [],
      };

      const snapshot = await service.recordUnderwritingSnapshot(
        "user-1",
        result,
      );

      expect(snapshot.band).toBe("excellent");
    });
  });
});
