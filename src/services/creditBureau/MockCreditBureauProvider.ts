/**
 * Mock Credit Bureau Provider
 * Deterministic implementation for testing
 * Returns scores based on BVN seed for consistent testing
 */

import { CreditBureauProvider, CreditReport } from "./CreditBureauProvider.js";

export class MockCreditBureauProvider implements CreditBureauProvider {
  async pullReport(
    tenantId: string,
    bvn: string,
    nin: string,
  ): Promise<CreditReport> {
    // Deterministic score based on last digit of BVN for test coverage
    const lastDigit = parseInt(bvn.charAt(bvn.length - 1), 10);
    const baseScore = 600 + lastDigit * 40; // Range: 600-990

    // Derogatory marks chance based on BVN
    const derogatoryChance = lastDigit < 3 ? 2 : lastDigit < 6 ? 1 : 0;
    const derogatoryMarks = Array.from(
      { length: derogatoryChance },
      (_, i) => ({
        type: ["late_payment", "default", "charge_off"][i % 3],
        date: new Date(
          Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        description: `Historical derogatory mark ${i + 1}`,
      }),
    );

    // Outstanding loans based on score
    const loanCount = baseScore > 750 ? 0 : baseScore > 650 ? 1 : 2;
    const outstandingLoans = Array.from({ length: loanCount }, (_, i) => ({
      lenderName: ["Bank A", "Bank B", "Fintech C"][i],
      amount: 500000 + Math.random() * 2000000,
      loanType: ["auto", "personal", "home"][i % 3],
    }));

    // Repayment history inversely correlated with derogatory marks
    const onTimeRate = Math.max(0.5, 1 - derogatoryChance * 0.2);
    const missedPayments = Math.max(0, derogatoryChance * 3);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days TTL

    return {
      score: baseScore,
      derogatoryMarks,
      outstandingLoans,
      repaymentHistory: {
        onTimePaymentRate: onTimeRate,
        missedPayments,
        defaultedLoans: Math.max(0, derogatoryChance - 1),
      },
      reportDate: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
