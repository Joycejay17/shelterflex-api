/**
 * Credit Bureau Provider Interface
 * Abstracts credit report retrieval from various bureau providers
 */

export interface CreditReport {
  score: number;
  derogatoryMarks: Array<{
    type: string;
    date: string;
    description: string;
  }>;
  outstandingLoans: Array<{
    lenderName: string;
    amount: number;
    loanType: string;
  }>;
  repaymentHistory: {
    onTimePaymentRate: number;
    missedPayments: number;
    defaultedLoans: number;
  };
  reportDate: string;
  expiresAt: string;
}

export interface CreditBureauProvider {
  /**
   * Pull credit report from the bureau
   * @param tenantId - Unique tenant identifier
   * @param bvn - Bank Verification Number (Nigeria)
   * @param nin - National Identification Number (Nigeria)
   * @returns Credit report from the bureau
   */
  pullReport(tenantId: string, bvn: string, nin: string): Promise<CreditReport>;
}
