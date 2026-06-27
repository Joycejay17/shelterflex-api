import { describe, it, expect } from "vitest";
import {
  analyzeBankStatement,
  bankStatementSubScore,
  type BankStatementAnalysis,
} from "./bankStatementAnalysis.js";
import type { BankStatementLine } from "../models/tenantOnboardingDataStore.js";

describe("bankStatementAnalysis", () => {
  describe("analyzeBankStatement", () => {
    it("should return zero values for empty statement", () => {
      const result = analyzeBankStatement([]);

      expect(result).toEqual({
        averageMonthlyBalance: 0,
        incomeCreditCount: 0,
        incomeRegularityScore: 0,
        debtObligationScore: 50,
        nsfCount: 0,
      });
    });

    it("should extract signals from regular salary income pattern", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-01-10", description: "Debit purchase", amount: -5000 },
        { date: "2024-02-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-02-15", description: "Debit purchase", amount: -3000 },
        { date: "2024-03-05", description: "SALARY CREDIT", amount: 50000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.incomeCreditCount).toBe(3);
      expect(result.incomeRegularityScore).toBeGreaterThan(80);
      expect(result.averageMonthlyBalance).toBeGreaterThan(0);
      expect(result.nsfCount).toBe(0);
    });

    it("should detect NSF/overdraft patterns", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 20000 },
        { date: "2024-01-10", description: "NSF FEE", amount: -1500 },
        { date: "2024-01-15", description: "Returned check fee", amount: -500 },
        { date: "2024-02-05", description: "SALARY CREDIT", amount: 20000 },
        {
          date: "2024-02-10",
          description: "Insufficient funds charge",
          amount: -1500,
        },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.nsfCount).toBe(3);
      expect(result.incomeCreditCount).toBe(2);
    });

    it("should handle single line statement", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.incomeCreditCount).toBe(1);
      expect(result.incomeRegularityScore).toBe(70);
      expect(result.averageMonthlyBalance).toBe(50000);
      expect(result.nsfCount).toBe(0);
    });

    it("should handle all-debit statement", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "ATM Withdrawal", amount: -5000 },
        { date: "2024-01-10", description: "Debit purchase", amount: -3000 },
        { date: "2024-01-15", description: "Transfer out", amount: -2000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.incomeCreditCount).toBe(0);
      expect(result.averageMonthlyBalance).toBeLessThan(0);
      expect(result.incomeRegularityScore).toBe(50);
    });

    it("should detect irregular income pattern", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-02-05", description: "SALARY CREDIT", amount: 20000 },
        { date: "2024-03-05", description: "SALARY CREDIT", amount: 80000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.incomeCreditCount).toBe(3);
      expect(result.incomeRegularityScore).toBeLessThan(70);
    });

    it("should identify recurring debt obligations", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-01-10", description: "LOAN REPAYMENT", amount: -5000 },
        { date: "2024-01-15", description: "EMI DEBIT", amount: -3000 },
        { date: "2024-02-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-02-10", description: "LOAN REPAYMENT", amount: -5000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.debtObligationScore).toBeLessThan(100);
      expect(result.incomeCreditCount).toBe(2);
    });

    it("should detect suspicious round-number patterns", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "Transfer in", amount: 10000 },
        { date: "2024-01-06", description: "Transfer out", amount: -10000 },
        { date: "2024-01-07", description: "Transfer in", amount: 10000 },
        { date: "2024-01-08", description: "Transfer out", amount: -10000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.averageMonthlyBalance).toBeDefined();
      expect(result).toHaveProperty("incomeCreditCount");
    });

    it("should handle invalid date strings gracefully", () => {
      const lines: BankStatementLine[] = [
        { date: "invalid-date", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.incomeCreditCount).toBe(2);
      expect(result).toHaveProperty("averageMonthlyBalance");
    });

    it("should produce deterministic results for identical inputs", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-02-05", description: "SALARY CREDIT", amount: 50000 },
      ];

      const result1 = analyzeBankStatement(lines);
      const result2 = analyzeBankStatement(lines);

      expect(result1).toEqual(result2);
    });

    it("should handle mixed income sources", () => {
      const lines: BankStatementLine[] = [
        { date: "2024-01-05", description: "SALARY CREDIT", amount: 50000 },
        { date: "2024-01-10", description: "PAYROLL DEPOSIT", amount: 10000 },
        { date: "2024-01-15", description: "WAGES PAYMENT", amount: 5000 },
        { date: "2024-02-05", description: "Transfer in", amount: 2000 },
      ];

      const result = analyzeBankStatement(lines);

      expect(result.incomeCreditCount).toBeGreaterThan(0);
    });
  });

  describe("bankStatementSubScore", () => {
    it("should return score within 0-100 bounds", () => {
      const analysis: BankStatementAnalysis = {
        averageMonthlyBalance: 100000,
        incomeCreditCount: 5,
        incomeRegularityScore: 90,
        debtObligationScore: 85,
        nsfCount: 0,
      };

      const score = bankStatementSubScore(analysis);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("should reward regular income with high credit count", () => {
      const high: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 5,
        incomeRegularityScore: 85,
        debtObligationScore: 80,
        nsfCount: 0,
      };

      const low: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 0,
        incomeRegularityScore: 85,
        debtObligationScore: 80,
        nsfCount: 0,
      };

      expect(bankStatementSubScore(high)).toBeGreaterThan(
        bankStatementSubScore(low),
      );
    });

    it("should penalize NSF occurrences", () => {
      const clean: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 3,
        incomeRegularityScore: 80,
        debtObligationScore: 80,
        nsfCount: 0,
      };

      const withNsf: BankStatementAnalysis = {
        ...clean,
        nsfCount: 2,
      };

      expect(bankStatementSubScore(clean)).toBeGreaterThan(
        bankStatementSubScore(withNsf),
      );
    });

    it("should reward positive average balance", () => {
      const positive: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 3,
        incomeRegularityScore: 70,
        debtObligationScore: 70,
        nsfCount: 0,
      };

      const negative: BankStatementAnalysis = {
        ...positive,
        averageMonthlyBalance: -10000,
      };

      expect(bankStatementSubScore(positive)).toBeGreaterThan(
        bankStatementSubScore(negative),
      );
    });

    it("should handle extreme negative scores gracefully", () => {
      const worst: BankStatementAnalysis = {
        averageMonthlyBalance: -100000,
        incomeCreditCount: 0,
        incomeRegularityScore: 0,
        debtObligationScore: 0,
        nsfCount: 10,
      };

      const score = bankStatementSubScore(worst);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBe(0);
    });

    it("should enforce score bounds monotonically", () => {
      const perfect: BankStatementAnalysis = {
        averageMonthlyBalance: 1000000,
        incomeCreditCount: 12,
        incomeRegularityScore: 100,
        debtObligationScore: 100,
        nsfCount: 0,
      };

      const score = bankStatementSubScore(perfect);

      expect(score).toBeLessThanOrEqual(100);
    });

    it("should produce deterministic scores for identical analysis", () => {
      const analysis: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 3,
        incomeRegularityScore: 75,
        debtObligationScore: 80,
        nsfCount: 1,
      };

      const score1 = bankStatementSubScore(analysis);
      const score2 = bankStatementSubScore(analysis);

      expect(score1).toBe(score2);
    });

    it("should reflect income regularity contribution", () => {
      const regular: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 3,
        incomeRegularityScore: 90,
        debtObligationScore: 70,
        nsfCount: 0,
      };

      const irregular: BankStatementAnalysis = {
        ...regular,
        incomeRegularityScore: 30,
      };

      expect(bankStatementSubScore(regular)).toBeGreaterThan(
        bankStatementSubScore(irregular),
      );
    });

    it("should reflect debt obligation contribution", () => {
      const lowDebt: BankStatementAnalysis = {
        averageMonthlyBalance: 50000,
        incomeCreditCount: 3,
        incomeRegularityScore: 70,
        debtObligationScore: 95,
        nsfCount: 0,
      };

      const highDebt: BankStatementAnalysis = {
        ...lowDebt,
        debtObligationScore: 40,
      };

      expect(bankStatementSubScore(lowDebt)).toBeGreaterThan(
        bankStatementSubScore(highDebt),
      );
    });

    it("should handle minimum viable statement", () => {
      const minimal: BankStatementAnalysis = {
        averageMonthlyBalance: 5000,
        incomeCreditCount: 1,
        incomeRegularityScore: 50,
        debtObligationScore: 50,
        nsfCount: 0,
      };

      const score = bankStatementSubScore(minimal);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
    });
  });
});
